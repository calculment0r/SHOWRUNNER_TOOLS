// Les morceaux du trombinoscope et de la propagation du theme, en un seul
// endroit : studio.mjs les pose a la generation, outils/casting.mjs les
// recolle sur les pages deja produites. Deux chemins, un seul code.
//
// Aucun de ces fragments ne contient de "${" : ils sont inseres tels quels
// dans le gabarit de studio.mjs, qui est un litteral gabarit.

export const CASTING_CSS = `
/* ── trombinoscope ── */
#casting .cast-head{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:6px}
#casting h2{font:700 19px/1.2 var(--ui);margin:0}
#casting .cast-sub{color:var(--ink-2);font-size:12.5px;max-width:74ch;margin:0 0 18px}
#casting .cast-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(430px,1fr));gap:14px}
#casting .fiche{display:grid;grid-template-columns:76px 1fr;gap:14px;border:1px solid var(--hairline-strong);background:var(--surface-2);padding:14px}
#casting .fiche .por{width:76px;height:76px;object-fit:cover;background:var(--surface-3);border:1px solid var(--hairline);display:block}
#casting .fiche .por.vide{display:flex;align-items:center;justify-content:center;font:700 22px/1 var(--mono);color:var(--ink-3)}
#casting .pid{font:700 10px/1 var(--mono);letter-spacing:1px;color:var(--ink-3);display:flex;align-items:center;gap:7px;margin-bottom:6px}
#casting .pastille{width:9px;height:9px;display:inline-block}
#casting input.nom{width:100%;font:600 14px/1.3 var(--ui);color:var(--ink);background:var(--surface);border:1px solid var(--hairline-strong);padding:7px 9px}
#casting input.nom:focus{outline:0;border-color:var(--red-accent);background:var(--surface-2)}
#casting input.nom.modifie{border-left:3px solid var(--signal)}
#casting select.fus{margin-top:7px;width:100%;font:500 11.5px/1.3 var(--ui);color:var(--ink-2);background:var(--surface);border:1px solid var(--hairline);padding:5px 7px}
#casting select.fus.modifie{border-left:3px solid var(--signal);color:var(--ink)}
#casting .note{font-size:11.5px;color:var(--ink-3);margin-top:7px;line-height:1.5}
#casting .chiffres{display:flex;flex-wrap:wrap;gap:3px 10px;margin-top:9px;font:600 9px/1.7 var(--ui);letter-spacing:.9px;text-transform:uppercase;color:var(--ink-2)}
#casting .chiffres i{font-style:normal;color:var(--hairline-strong)}
#casting .barre{position:sticky;bottom:0;margin-top:20px;padding:12px 0;background:var(--surface);border-top:1px solid var(--hairline);display:flex;gap:9px;align-items:center;flex-wrap:wrap}
#casting button{height:29px;padding:0 15px;font:600 10px/1 var(--ui);letter-spacing:1.1px;text-transform:uppercase;border:1px solid var(--hairline-strong);background:var(--surface-2);color:var(--ink);cursor:pointer}
#casting button:hover{background:var(--surface-3)}
#casting button.fort{border-color:var(--red-accent);background:var(--red-fill);color:var(--red-accent)}
#casting button:disabled{opacity:.4;cursor:default}
#casting .etat{font-size:11.5px;color:var(--ink-3)}
#casting .reunies{display:flex;flex-direction:column;gap:4px;margin-top:8px;font-size:11px;color:var(--ink-3)}
#casting .reunies span{display:flex;align-items:center;gap:8px}
#casting .reunies button.separer{height:auto;padding:3px 8px;font-size:9px;letter-spacing:.6px;border-radius:4px}
#casting .avis{border-left:3px solid var(--signal);background:var(--signal-fill);padding:11px 13px;margin:18px 0 0;font-size:11.5px;color:var(--ink-2);line-height:1.6}
@media(max-width:560px){#casting .fiche{grid-template-columns:56px 1fr}#casting .fiche .por{width:56px;height:56px}}`;

export const CASTING_ONGLET = '<button data-tab="casting" aria-pressed="false">Casting</button>';

export const CASTING_SECTION = `
<main id="casting" class="wrap" hidden>
  <div class="cast-head"><h2>Trombinoscope</h2></div>
  <p class="cast-sub">Les visages que la chaîne a regroupés, et le nom que le modèle leur a donné.
  Corrigez un nom, ou dites que deux fiches sont la même personne : tout se met à jour
  d'un coup — scénario, timeline, fiche de plan, dépouillement. Les répliques s'éditent
  directement dans le scénario.</p>
  <div class="cast-grid" id="cast-grid"></div>
  <div id="cast-ecartes"></div>
  <div class="barre">
    <button id="cast-annuler" disabled title="Annuler le dernier geste (Ctrl+Z)">↶ Annuler</button>
    <button class="fort" id="cast-appliquer" disabled>Appliquer</button>
    <button id="cast-fichier" title="Enregistrer pour tous, dans le dépôt partagé">Enregistrer</button>
    <button id="cast-github" hidden>Publier sur GitHub</button>
    <button id="cast-defusion">Défaire les fusions</button>
    <button id="cast-reinit">Repartir de la chaîne</button>
    <span class="etat" id="cast-etat"></span>
  </div>
  <div class="avis"><b>Ce que la chaîne ne peut pas trouver seule.</b> Un très gros plan, une main
  qui tient un téléphone : aucun visage lisible, aucune silhouette comparable — et pourtant
  c'est quelqu'un qu'on connaît. Dites-le ici une fois.
  « Enregistrer » la partage aussitôt avec tous ceux qui ouvrent cette page, de n'importe quel ordinateur ;
  « Publier sur GitHub » la grave dans le dépôt, et la chaîne la relit à chaque rendu.</div>
</main>`;

/** Les corrections du trombinoscope, appliquees a un document.
 *
 *  Trois choses qu'une mesure ne peut pas trouver seule et qu'un oeil voit tout
 *  de suite : le nom d'un personnage, le fait que deux fiches sont la meme
 *  personne (un tres gros plan, une main qui tient un telephone : aucun visage,
 *  aucune silhouette comparable, et pourtant c'est elle), et une replique mal
 *  transcrite. Elles vivent dans un `corrections.json` a cote de la page.
 *
 *  Cette fonction est le SEUL endroit qui sait les appliquer : studio.mjs l'appelle
 *  en Node a la generation, et la page la rejoue dans le navigateur par
 *  CORRECTIONS_JS ci-dessous. Elle doit donc rester autonome — aucune reference
 *  hors de son corps, sinon son `toString()` ne tient pas debout dans la page.
 *  Elle est idempotente : l'appliquer deux fois ne change rien de plus. */
export function appliqueCorrections(doc, corr) {
  if (!doc || !corr || typeof corr !== 'object') return doc;
  const fus = corr.fusions || {}, noms = corr.noms || {}, rep = corr.repliques || {}, loc = corr.locuteurs || {};
  const cible = (id) => { let x = id; for (let n = 0; n < 8 && fus[x] && fus[x] !== x; n++) x = fus[x]; return x; };
  if (Object.keys(fus).length && Array.isArray(doc.cast)) {
    const garde = doc.cast.filter((p) => cible(p.id) === p.id);
    const par = {};
    garde.forEach((p) => { par[p.id] = p; });
    doc.cast.forEach((p) => {
      const c = cible(p.id);
      if (c === p.id || !par[c]) return;
      par[c].tracks = (par[c].tracks || []).concat(p.tracks || []);
      par[c].absorbees = (par[c].absorbees || []).concat([p.id]);
    });
    doc.cast = garde;
  }
  const vivant = {};
  (doc.cast || []).forEach((p) => { vivant[p.id] = true; });
  (doc.shots || []).forEach((s) => {
    const vus = [];
    (s.subjects || []).map(cible).forEach((id) => { if (vivant[id] && vus.indexOf(id) < 0) vus.push(id); });
    s.subjects = vus;
    (s.lines || []).forEach((l) => {
      if (l.speaker) l.speaker = cible(l.speaker);
      const k = l.start + '-' + l.end;
      if (typeof rep[k] === 'string') l.text = rep[k];
      // qui dit la replique, pose a la main dans la timeline : un personnage, ou '' pour personne (voix off).
      // Une replique partagee mot a mot entre plusieurs personnages (un tableau) garde son locuteur : la
      // timeline de la page sait la decouper, un document plat non.
      if (typeof loc[k] === 'string') l.speaker = loc[k] ? cible(loc[k]) : null;
    });
    if (s.masks) {
      const m = {};
      Object.keys(s.masks).forEach((k) => {
        const n = cible(k); if (!vivant[n]) return;
        const v = s.masks[k];
        m[n] = m[n]
          ? { coverage: Math.round((m[n].coverage + v.coverage) * 10) / 10, frames: Math.max(m[n].frames, v.frames), share: Math.min(1, m[n].share + v.share) }
          : v;
      });
      s.masks = m;
    }
  });
  if (doc.voices) Object.keys(doc.voices).forEach((v) => { const o = doc.voices[v]; if (o && o.person) o.person = cible(o.person); });
  (doc.cast || []).forEach((p) => { if (noms[p.id]) p.name = noms[p.id]; });
  const nom = (id) => { const p = (doc.cast || []).find((c) => c.id === id); return p ? p.name : id; };
  if (doc.voices) Object.keys(doc.voices).forEach((v) => { const o = doc.voices[v]; if (o && o.person) o.name = nom(o.person); });
  (doc.shots || []).forEach((s) => {
    if (s.lines && s.lines.length) s.audio = s.lines.map((l) => (l.speaker ? nom(l.speaker) : '?') + ' : ' + l.text).join(' / ');
  });
  return doc;
}

/** La meme fonction, portee telle quelle dans la page. */
// `toString()` rend le source tel qu'il a ete lu : sur un checkout Windows il
// arrive en CRLF et la page rendue differe de celle rendue ailleurs, pour rien.
export const CORRECTIONS_JS = `\nconst appliqueCorrections = ${appliqueCorrections.toString().replace(/\r\n/g, '\n')};`;

/** Le magasin des corrections cote navigateur, et la reprise de l'ancien format
 *  (une simple table de noms sous `xverse-cast-<slug>`).
 *  A n'inserer QUE dans la portee ou DATA est visible : « const DATA » vit dans
 *  l'environnement lexical global, pas sur window. */
export const appliqueNoms = (slug) => `
window.XV_CLE = 'xverse-corr-' + ${JSON.stringify(slug)};
window.XV_CLE_V1 = 'xverse-cast-' + ${JSON.stringify(slug)};
window.xvCorrections = function () {
  let c = null;
  try { c = JSON.parse(localStorage.getItem(window.XV_CLE) || 'null'); } catch (e) {}
  if (!c) {
    // ancien format : rien qu'une table de noms. On la reprend telle quelle.
    try { const v1 = JSON.parse(localStorage.getItem(window.XV_CLE_V1) || 'null'); if (v1) c = { noms: v1 }; } catch (e) {}
  }
  c = c || {};
  c.noms = c.noms || {}; c.fusions = c.fusions || {}; c.repliques = c.repliques || {}; c.locuteurs = c.locuteurs || {}; c.voix = c.voix || {};
  return c;
};
window.xvPoseCorrections = function (c) {
  try { localStorage.setItem(window.XV_CLE, JSON.stringify(c)); } catch (e) {}
};
// compatibilite : le depouillement et les pages recollees lisent encore les noms seuls
window.xvNomsMemorises = function () { return window.xvCorrections().noms; };
appliqueCorrections(DATA, window.xvCorrections());`;

/** La bascule a trois onglets. Remplace celle a deux. */
export const ONGLETS = `
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#tabs button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  const onglet = b.dataset.tab;
  ['studio', 'depouillement', 'casting'].forEach((n) => { const el = $(n); if (el) el.hidden = (n !== onglet); });
  const fr = document.querySelector('#depouillement iframe');
  if (onglet === 'depouillement' && fr && !fr.src) fr.src = fr.dataset.src;
}));`;

/** Le trombinoscope. Suppose DATA, PORTRAITS, CAST_COLORS, $ et esc en portee. */
export const TROMBINOSCOPE = `
(function () {
  const PORT = (typeof PORTRAITS === 'object' && PORTRAITS) || {};
  const COUL = (typeof CAST_COLORS !== 'undefined' && CAST_COLORS) || [];
  const noms = window.xvNomsMemorises();
  const origine = {};
  DATA.cast.forEach((p) => { origine[p.id] = noms[p.id] ? null : p.name; });

  /* Chiffres tires des plans : presence, part d'image, repliques. */
  const stats = {};
  DATA.cast.forEach((p) => { stats[p.id] = { plans: 0, repliques: 0, parts: [] }; });
  (DATA.shots || []).forEach((s) => {
    (s.subjects || []).forEach((id) => { if (stats[id]) stats[id].plans++; });
    Object.entries(s.masks || {}).forEach(([id, m]) => {
      if (stats[id] && m && typeof m.coverage === 'number') stats[id].parts.push(m.coverage);
    });
    (s.lines || []).forEach((l) => { if (l && stats[l.speaker]) (stats[l.speaker].vues = stats[l.speaker].vues || {})[l.start + '-' + l.end] = 1; });
  });
  Object.values(stats).forEach((st) => { st.repliques = Object.keys(st.vues || {}).length; });

  const cuites = {};
  ((typeof DATA0 !== 'undefined' && DATA0.cast) || []).forEach((q) => { (q.absorbees || []).forEach((a) => { cuites[a] = true; }); });
  const nomOrigine = (id) => { const q = ((typeof DATA0 !== 'undefined' && DATA0.cast) || []).find((x) => x.id === id); return q ? q.name : id; };
  const reunies = (p) => {
    const vivantes = (p.absorbees || []).filter((a) => !cuites[a]);
    if (!vivantes.length) return '';
    return '<div class="reunies">' + vivantes.map((a) => '<span>réunie : ' + esc(a) + ' · ' + esc(nomOrigine(a)) +
      ' <button class="separer" data-id="' + esc(a) + '" type="button">séparer</button></span>').join('') + '</div>';
  };
  // Deposer une fiche sur une autre, ou choisir « meme personne que » : la fusion s'applique TOUT DE SUITE — la
  // fausse fiche disparait, ses plans et ses repliques passent a l'autre — et part au depot partage.
  const fusionne = (source, cible) => {
    if (!source || !cible || source === cible) return;
    if (window.xvMemorise) window.xvMemorise();
    const c = window.xvCorrections();
    c.fusions[source] = cible;
    window.xvPoseCorrections(c);
    rejoue();
    if (window.xvEnregistrePartage) window.xvEnregistrePartage(['fusions'], $('cast-etat'));
  };
  window.xvFusionne = fusionne;
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('#cast-grid button.separer');
    if (!b) return;
    if (window.xvMemorise) window.xvMemorise();
    const c = window.xvCorrections();
    c.fusions[b.dataset.id] = b.dataset.id;   // « a part », meme si le depot partage la reunissait
    window.xvPoseCorrections(c);
    rejoue();
    if (window.xvEnregistrePartage) window.xvEnregistrePartage(['fusions'], $('cast-etat'));
  });
  const dessine = () => {
    /* Les chiffres se relisent a chaque dessin : une fusion change les comptes. */
    DATA.cast.forEach((p) => { stats[p.id] = stats[p.id] || { plans: 0, repliques: 0, parts: [] }; });
    Object.keys(stats).forEach((id) => { stats[id] = { plans: 0, repliques: 0, parts: [] }; });
    (DATA.shots || []).forEach((s) => {
      (s.subjects || []).forEach((id) => { if (stats[id]) stats[id].plans++; });
      Object.entries(s.masks || {}).forEach(([id, m]) => {
        if (stats[id] && m && typeof m.coverage === 'number') stats[id].parts.push(m.coverage);
      });
      (s.lines || []).forEach((l) => { if (l && stats[l.speaker]) (stats[l.speaker].vues = stats[l.speaker].vues || {})[l.start + '-' + l.end] = 1; });
    });
    // une replique qui enjambe un raccord est rangee dans chaque plan qu'elle recouvre : on la compte une fois
    Object.values(stats).forEach((st) => { st.repliques = Object.keys(st.vues || {}).length; });
    $('cast-grid').innerHTML = DATA.cast.map((p, i) => {
      const st = stats[p.id] || { plans: 0, repliques: 0, parts: [] };
      const part = st.parts.length ? (st.parts.reduce((a, b) => a + b, 0) / st.parts.length) : null;
      const por = PORT[p.id]
        ? '<img class="por" alt="' + esc(p.name) + '" src="' + PORT[p.id] + '">'
        : '<span class="por vide">' + esc(p.id) + '</span>';
      const coul = COUL.length ? COUL[i % COUL.length] : 'var(--hairline-strong)';
      /* « Même personne que … » : la seule chose qu'un oeil sait et que la mesure ignore. */
      const choix = ['<option value="">fiche à part</option>'].concat(
        DATA.cast.filter((q) => q.id !== p.id).map((q) => '<option value="' + esc(q.id) + '">même personne que ' + esc(q.id) + ' · ' + esc(q.name) + '</option>'),
      ).join('');
      return '<div class="fiche">' + por + '<div>' +
        // Un numero de fiche ne dit rien a personne, et « P3 + P5, P7 » encore moins.
        // Le rang dans la distribution suffit a la designer ; ce qui a ete reuni se dit
        // en clair, sans etaler des identifiants internes.
        '<div class="pid"><span class="pastille" style="background:' + coul + '"></span>' + (i + 1) +
        (p.absorbees && p.absorbees.length ? '<span style="letter-spacing:0;text-transform:none">· ' + (p.absorbees.length + 1) + ' fiches réunies</span>' : '') + '</div>' +
        '<input class="nom" data-id="' + esc(p.id) + '" value="' + esc(p.name) + '" spellcheck="false" aria-label="Nom de ' + esc(p.id) + '">' +
        '<select class="fus" data-id="' + esc(p.id) + '" aria-label="Fusionner ' + esc(p.id) + '">' + choix + '</select>' +
        (p.note ? '<div class="note">' + esc(p.note) + '</div>' : '') +
        // Les fiches reunies a celle-ci : celles de la page se separent d'un clic ; celles du rendu (corrections.json
        // deja applique a la generation) ne peuvent plus l'etre ici.
        reunies(p) +
        '<div class="chiffres"><span>' + st.plans + ' plan' + (st.plans > 1 ? 's' : '') + '</span>' +
        (st.repliques ? '<i>·</i><span>' + st.repliques + ' réplique' + (st.repliques > 1 ? 's' : '') + '</span>' : '') +
        (part !== null ? '<i>·</i><span>' + part.toFixed(1) + " % d'image</span>" : '') +
        (p.by ? '<i>·</i><span>nommé par ' + esc(p.by) + '</span>' : '') +
        '</div></div></div>';
    }).join('');
    ecartes();
    marque();
  };
  window.xvDessineCasting = dessine;

  /* Ce que le regroupement n'a pas retenu. Une distribution amputee doit se voir. */
  const ecartes = () => {
    const el = $('cast-ecartes'); if (!el) return;
    const ex = DATA.extras || [];
    if (!ex.length) { el.innerHTML = ''; return; }
    const total = ex.reduce((a, e) => a + (e.secondes || 0), 0);
    el.innerHTML = '<div class="avis"><b>' + ex.length + ' silhouette' + (ex.length > 1 ? 's' : '') +
      ' écartée' + (ex.length > 1 ? 's' : '') + '</b> — ' + total.toFixed(1) + " s à l'image au total, " +
      'sans fiche. Un personnage qui ne montre jamais son visage (de dos, masqué, en arrière-plan) ' +
      'tombe ici. Relancer la chaîne avec <code>--figurants garder</code> leur ouvre une fiche.<br>' +
      ex.map((e) => '<span class="mono">' + esc(String(e.de)) + '→' + esc(String(e.a)) + ' s</span> · ' +
        esc(String(e.secondes)) + ' s · ' + esc(e.motif || '')).join('<br>') + '</div>';
  };

  const saisis = () => {
    const noms = {}, fusions = {};
    document.querySelectorAll('#cast-grid input.nom').forEach((i) => {
      const v = i.value.trim();
      if (v) noms[i.dataset.id] = v;
    });
    document.querySelectorAll('#cast-grid select.fus').forEach((s) => {
      if (s.value) fusions[s.dataset.id] = s.value;
    });
    return { noms, fusions };
  };
  const change = () => {
    const a = saisis();
    return DATA.cast.some((p) => (a.noms[p.id] || p.name) !== p.name) || Object.keys(a.fusions).length > 0;
  };
  const marque = () => {
    const a = saisis();
    document.querySelectorAll('#cast-grid input.nom').forEach((i) => {
      const p = DATA.cast.find((c) => c.id === i.dataset.id);
      i.classList.toggle('modifie', !!p && a.noms[p.id] !== p.name);
    });
    document.querySelectorAll('#cast-grid select.fus').forEach((s) => s.classList.toggle('modifie', !!s.value));
    $('cast-appliquer').disabled = !change();
    $('cast-etat').textContent = change() ? 'Modifications non appliquées.' : 'À jour.';
  };

  document.addEventListener('input', (e) => { if (e.target.matches('#cast-grid input.nom, #cast-grid select.fus')) marque(); });
  document.addEventListener('change', (e) => { if (e.target.matches('#cast-grid select.fus') && e.target.value) fusionne(e.target.dataset.id, e.target.value); });

  /* Rejouer depuis le document d'origine quand la page sait le faire : une fusion
     retire une fiche, et rien ne doit s'appliquer deux fois sur un DATA deja rogne. */
  const rejoue = () => { if (typeof window.xvRafraichir === 'function') window.xvRafraichir(); else location.reload(); };

  $('cast-appliquer').addEventListener('click', () => {
    const a = saisis();
    const c = window.xvCorrections();
    DATA.cast.forEach((p) => { if (a.noms[p.id] && a.noms[p.id] !== p.name) c.noms[p.id] = a.noms[p.id]; });
    Object.keys(a.fusions).forEach((id) => { c.fusions[id] = a.fusions[id]; });
    window.xvPoseCorrections(c);
    rejoue();
  });

  // Une fusion posee par erreur doit se defaire sans tout perdre : les noms et les
  // repliques corrigees restent.
  $('cast-defusion').addEventListener('click', () => {
    // celles du depot partage aussi : chaque fiche y est remise « a part »
    if (window.xvMemorise) window.xvMemorise();
    const c = window.xvCorrections(); c.fusions = {};
    Object.keys((window.XV_CORR_FICHIER || {}).fusions || {}).forEach((id) => { c.fusions[id] = id; });
    window.xvPoseCorrections(c); rejoue();
    if (window.xvEnregistrePartage) window.xvEnregistrePartage(['fusions'], $('cast-etat'));
  });

  $('cast-reinit').addEventListener('click', () => {
    try { localStorage.removeItem(window.XV_CLE); localStorage.removeItem(window.XV_CLE_V1); } catch (e) {}
    rejoue();
  });

  $('cast-fichier').addEventListener('click', async () => {
    const a = saisis();
    // Partir du fichier deja pose a cote de la page, pas de la seule memoire de CE
    // navigateur : sinon enregistrer effacait les corrections faites ailleurs — les
    // fusions du fichier disparaissaient a la premiere sauvegarde.
    const base = window.XV_CORR_FICHIER || {};
    const c = window.xvCorrections();
    c.noms = Object.assign({}, base.noms || {}, c.noms);
    c.fusions = Object.assign({}, base.fusions || {}, c.fusions);
    c.repliques = Object.assign({}, base.repliques || {}, c.repliques);
    c.locuteurs = Object.assign({}, base.locuteurs || {}, c.locuteurs);
    c.voix = Object.assign({}, base.voix || {}, c.voix);
    DATA.cast.forEach((p) => { if (a.noms[p.id] && a.noms[p.id] !== p.name) c.noms[p.id] = a.noms[p.id]; });
    Object.keys(a.fusions).forEach((id) => { c.fusions[id] = a.fusions[id]; });
    // temoin : si la chaine renumerote les fiches, un rendu ulterieur pourra le dire
    c.pistes = {};
    DATA.cast.forEach((p) => { if (p.tracks) c.pistes[p.id] = p.tracks; });
    const json = JSON.stringify(c, null, 2);
    // Servie en local, la page ECRIT le fichier a sa place : plus rien a promener.
    // En ligne, personne n'ecrit sur un hebergement statique — et surtout pas avec un
    // jeton depose dans une page publique. On retombe alors sur le telechargement.
    $('cast-etat').textContent = 'enregistrement…';
    let ecrit = false;
    // Le depot partage d'abord : c'est lui qui rend la correction visible par tout le
    // monde, en ligne, sans que personne ait de jeton a coller.
    // Dans le portail, le portail d'abord : le depot partage de MOVIE_ANALYSE y refuse l'ecriture (XV_PARTAGE_REFUS).
    const cible = window.XV_CORR_PORTAIL || window.XV_CORR_URL;
    if (cible) {
      try {
        const r = await fetch(cible, { method: 'PUT', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: json });
        if (r.ok && (await r.json().catch(() => ({}))).ok === true) {
          window.XV_CORR_FICHIER = c;
          // parti chez tout le monde : ce navigateur n'a plus rien a garder pour lui (sinon, ailleurs, une vieille
          // memoire passerait par-dessus les corrections des autres)
          window.xvPoseCorrections({});
          if (window.xvEtatPartage) window.xvEtatPartage();
          $('cast-etat').textContent = window.XV_CORR_PORTAIL ? 'enregistré dans le portail — visible par tous ceux qui ouvrent le portail.' : 'enregistré — visible par tous ceux qui ouvrent cette page.';
          if (window.XV_PARTAGE_REFUS) $('cast-etat').title = window.XV_PARTAGE_REFUS;
          return;
        }
      } catch (e) {}
    }
    try {
      const r = await fetch('corrections.json', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: json });
      // Un 200 ne prouve rien : un hebergement statique repond 200 en SERVANT le
      // fichier, quelle que soit la methode. On exige la confirmation du serveur.
      ecrit = r.ok && (await r.json().catch(() => ({}))).ok === true;
    } catch (e) { ecrit = false; }
    if (ecrit) {
      $('cast-etat').textContent = 'écrit dans le dossier de l’analyse — il ne reste qu’à pousser sur GitHub.';
      return;
    }
    const blob = new Blob([json], { type: 'application/json' });
    const a2 = document.createElement('a');
    a2.href = URL.createObjectURL(blob); a2.download = 'corrections.json';
    document.body.appendChild(a2); a2.click(); a2.remove();
    setTimeout(() => URL.revokeObjectURL(a2.href), 4000);
    $('cast-etat').textContent = 'corrections.json téléchargé — à déposer dans le dossier de l’analyse, puis pousser.';
  });

  /* ── publier sur GitHub : par le dépôt partagé (Cloudflare, outils/partage), qui garde lui-même le jeton GitHub.
     Plus aucun jeton dans un navigateur (28/09 : il liait la publication à UN ordinateur). */
  try { localStorage.removeItem('xverse-jeton-github'); } catch (e) {}   // l'ancien jeton, s'il traînait ici
  if (window.XV_PUBLIER_URL) {
    $('cast-github').hidden = false;
    // Dans le portail, le depot partage refuse de publier depuis cette adresse (403, avant tout envoi a GitHub) :
    // le bouton reste, dit pourquoi, et mene a la page de MOVIE_ANALYSE, d'ou la publication marche.
    if (window.XV_PARTAGE_REFUS) {
      $('cast-github').title = 'pas depuis le portail : ' + window.XV_PARTAGE_REFUS;
      $('cast-github').setAttribute('aria-disabled', 'true');
    }
    $('cast-github').addEventListener('click', async () => {
      if (window.XV_PARTAGE_REFUS) {
        const e = $('cast-etat');
        e.textContent = 'pas publié d’ici : le dépôt partagé de MOVIE_ANALYSE refuse l’adresse du portail (403). Publier depuis sa page : ';
        if (window.XV_PAGE_MA) { const a = document.createElement('a'); a.href = window.XV_PAGE_MA; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'le Studio sur calculment0r.github.io'; e.append(a); }
        e.title = window.XV_PARTAGE_REFUS;
        return;
      }
      const a = saisis();
      const base = window.XV_CORR_FICHIER || {};
      const c = window.xvCorrections();
      c.noms = Object.assign({}, base.noms || {}, c.noms);
      c.fusions = Object.assign({}, base.fusions || {}, c.fusions);
      c.repliques = Object.assign({}, base.repliques || {}, c.repliques);
      c.locuteurs = Object.assign({}, base.locuteurs || {}, c.locuteurs);
      c.voix = Object.assign({}, base.voix || {}, c.voix);
      DATA.cast.forEach((p) => { if (a.noms[p.id] && a.noms[p.id] !== p.name) c.noms[p.id] = a.noms[p.id]; });
      Object.keys(a.fusions).forEach((id) => { c.fusions[id] = a.fusions[id]; });
      c.pistes = {};
      DATA.cast.forEach((p) => { if (p.tracks) c.pistes[p.id] = p.tracks; });
      $('cast-etat').textContent = 'publication…';
      try {
        const r = await fetch(window.XV_PUBLIER_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c, null, 2) });
        const d = await r.json().catch(() => ({}));
        if (r.ok && d.ok) {
          window.XV_CORR_FICHIER = c; window.xvPoseCorrections({}); if (window.xvEtatPartage) window.xvEtatPartage();
          $('cast-etat').textContent = 'publié sur GitHub — la page en ligne suivra à la prochaine construction (une minute environ).';
        } else {
          $('cast-etat').textContent = 'pas publié : ' + (d.erreur || 'réponse ' + r.status) + (r.status >= 500 ? ' — les corrections sont quand même enregistrées pour tous.' : '');
        }
      } catch (e) { $('cast-etat').textContent = 'dépôt partagé injoignable : ' + e.message; }
    });
  }

  dessine();
})();`;

/** Le depouillement est une iframe : document separe, il ne recoit pas le
 *  theme du parent. Le parent le lui pousse. */
export const THEME_VERS_IFRAME = `
(function () {
  const cadre = () => document.querySelector('#depouillement iframe');
  function pousse() {
    const t = document.documentElement.dataset.theme || 'light';
    const fr = cadre(); if (!fr) return;
    // Meme origine : on pose l'attribut directement. Sous file:// l'acces est
    // refuse, d'ou le postMessage qui suit.
    try { const d = fr.contentDocument; if (d && d.documentElement) d.documentElement.dataset.theme = t; } catch (e) {}
    try { if (fr.contentWindow) fr.contentWindow.postMessage({ xverseTheme: t }, '*'); } catch (e) {}
  }
  new MutationObserver(pousse).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const fr = cadre();
  if (fr) fr.addEventListener('load', pousse);
  pousse();
})();`;

/** A poser dans le depouillement lui-meme : il lit le theme memorise quand on
 *  l'ouvre seul, et ecoute le parent quand il est en cadre. */
export const THEME_DANS_DEPOUILLEMENT = `
(function () {
  const pose = (t) => { document.documentElement.dataset.theme = (t === 'dark' ? 'dark' : 'light'); };
  try { pose(localStorage.getItem('xverse-theme')); } catch (e) { pose('light'); }
  addEventListener('message', (e) => { if (e && e.data && e.data.xverseTheme) pose(e.data.xverseTheme); });
  addEventListener('storage', (e) => { if (e.key === 'xverse-theme') pose(e.newValue); });
})();`;

/** Les noms corriges, cote depouillement, ou le casting s'appelle DOC.cast. */
export const NOMS_DANS_DEPOUILLEMENT = (slug) => `
(function () {
  let c = null;
  try { c = JSON.parse(localStorage.getItem('xverse-corr-' + ${JSON.stringify(slug)}) || 'null'); } catch (e) {}
  if (!c) { try { const v1 = JSON.parse(localStorage.getItem('xverse-cast-' + ${JSON.stringify(slug)}) || 'null'); if (v1) c = { noms: v1 }; } catch (e) {} }
  if (!c) return;
  const noms = c.noms || {}, fus = c.fusions || {};
  const cible = (id) => { let x = id; for (let n = 0; n < 8 && fus[x] && fus[x] !== x; n++) x = fus[x]; return x; };
  if (typeof DOC === 'object' && DOC && Array.isArray(DOC.cast)) {
    // Une fiche absorbee garde le nom de celle qui l'absorbe : le depouillement est
    // un document fige, on ne le recompose pas, mais il ne doit pas nommer deux fois
    // la meme personne autrement.
    DOC.cast.forEach((p) => { const t = cible(p.id); if (noms[t]) p.name = noms[t]; else if (t !== p.id) { const q = DOC.cast.find((x) => x.id === t); if (q) p.name = q.name; } });
  }
})();`;
