// MOVIE ANALYSIS — l'accueil de l'outil dans le portail : les analyses (celles du
// dépôt, copiées de MOVIE_ANALYSE, et celles faites d'ici), la diarisation, les
// projets du dépôt partagé, l'état de la chaîne, et « Nouvelle analyse », qui
// lance la chaîne complète sur DGX2 par la file des rendus (travail analyse.run).
import { mountHeader, api, jobs, pick, thumb, toast, el, $, $$, href, fmtDur, fmtDate, dropZone } from '../commun/shell.js';

mountHeader('analyse');
favicon();

const S = { analyses: [], chaine: null, source: 'bib', video: null, langue: 'fr', sceneflow: false, nomLibre: null, nomVu: '' };

// ── l'icône, dessinée depuis les jetons (aucune couleur écrite ici) ──
function favicon() {
  try {
    const cs = getComputedStyle(document.documentElement);
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = cs.getPropertyValue('--or').trim(); g.beginPath(); g.roundRect(0, 0, 32, 32, 6); g.fill();
    g.fillStyle = cs.getPropertyValue('--on-or').trim(); g.fillRect(12, 12, 8, 8);
    $('link[rel=icon]').href = c.toDataURL();
  } catch { /* sans canvas : pas d'icône */ }
}

const nb = (x) => (x === null || x === undefined ? '—' : String(x));
const dims = (c) => (c.largeur && c.hauteur ? `${c.largeur}×${c.hauteur}` : '');

// ── les analyses ────────────────────────────────────────────
async function chargeAnalyses() {
  try {
    const r = await api('analyse/list');
    S.analyses = r.analyses || [];
    if (r.runs) $('#nv-runs').textContent = r.runs.replace(/^\/home\/[^/]+/, '~') + '/';
  } catch (e) {
    $('#analyses').replaceChildren(el('p', { class: 'warn' }, 'le portail ne répond pas : ' + e.message));
    return;
  }
  peint();
}

// les chiffres d'une analyse (plans, personnages, répliques, voix), les mêmes sur les deux sortes de cartes
function chiffresDe(a) {
  const c = a.chiffres || {};
  const perso = c.reunies ? `${c.fiches} fiches de la chaîne, ${c.reunies} réunies par les corrections` : `${c.fiches} fiches de la chaîne`;
  return el('dl', { class: 'ma-n' },
    el('div', {}, el('dt', {}, 'plans'), el('dd', {}, nb(c.plans))),
    el('div', { title: perso }, el('dt', {}, 'personnages'), el('dd', {}, nb(c.personnages))),
    el('div', {}, el('dt', {}, 'répliques'), el('dd', {}, nb(c.repliques))),
    el('div', { title: c.voix ? 'diarisation Nemotron embarquée dans le Studio' : 'pas encore de diarisation : le labo la calcule' },
      el('dt', {}, 'voix'), el('dd', { class: c.voix ? 'ok' : 'non' }, c.voix ? 'oui' : 'non')));
}
// les vues de la page du film (Studio, Casting, Dépouillement : une page du portail) et le labo des voix
function vuesDe(a) {
  return [
    a.studio ? el('a', { class: 'tb ghost sm', href: href(a.studio) }, 'Studio') : null,
    a.casting ? el('a', { class: 'tb ghost sm', href: href(a.casting) }, 'Casting') : null,
    a.depouillement ? el('a', { class: 'tb ghost sm', href: href(a.depouillement) }, 'Dépouillement') : null,
    el('a', { class: 'tb ghost sm', href: href(a.labo), title: 'la diarisation de ce film, dans le labo' }, 'Voix'),
  ];
}

// un de nos films : en grand, son image, ses chiffres ; l'image ouvre le Studio
function carteFilm(a) {
  const c = a.chiffres || {};
  const genre = [a.genre, dims(c), c.langue].filter(Boolean).join(' · ');
  return el('article', { class: 'ma-film' },
    el('a', { class: 'ma-film-im', href: a.studio ? href(a.studio) : null, title: 'ouvrir le Studio',
      style: a.affiche ? { backgroundImage: `url(${href(a.affiche)})` } : null },
      el('span', { class: 'kind' }, 'MOVIE_ANALYSE'),
      c.duree ? el('span', { class: 'dur' }, fmtDur(c.duree)) : null,
      el('span', { class: 'go' }, 'Ouvrir le Studio →')),
    el('div', { class: 'ma-film-b' },
      el('div', { class: 'ma-film-t' }, el('h3', {}, a.titre), el('span', { class: 'ma-s' }, genre || '—')),
      chiffresDe(a),
      el('div', { class: 'row' }, ...vuesDe(a), el('span', { class: 'sp' }),
        el('span', { class: 'lbl', title: 'la vidéo et ses pistes de son sur Cloudflare R2, les corrections dans le dépôt partagé de MOVIE_ANALYSE' },
          'vidéo sur R2'))));
}

// une analyse lancée d'ici : la même page, une carte plus petite
function carte(a) {
  const c = a.chiffres || {};
  const genre = [a.genre, dims(c), c.langue].filter(Boolean).join(' · ');
  return el('article', { class: 'ma-card' },
    el('a', { class: 'ma-im', href: a.studio ? href(a.studio) : null, title: 'ouvrir le Studio',
      style: (a.affiche || a.vignette) ? { backgroundImage: `url(${href(a.affiche || a.vignette)})` } : null },
      el('span', { class: 'kind ' + a.source }, a.source === 'depot' ? 'dépôt' : 'portail'),
      c.duree ? el('span', { class: 'dur' }, fmtDur(c.duree)) : null),
    el('div', { class: 'ma-body' },
      el('div', { class: 'ma-t' }, a.titre),
      el('div', { class: 'ma-s' }, genre || '—'),
      chiffresDe(a),
      el('div', { class: 'row' }, ...vuesDe(a), el('span', { class: 'sp' }),
        el('span', { class: 'lbl', title: a.run || '' }, fmtDate(a.date)))));
}

// un travail en cours (ou fini, pas encore relu) : même carte, avec sa progression
function carteTravail(j) {
  const p = j.params || {};
  const fini = j.state === 'done';
  const echec = ['error', 'cancelled', 'interrupted'].includes(j.state);
  const etat = { queued: 'en file', running: 'en cours', done: 'fini', error: 'échec', cancelled: 'arrêté', interrupted: 'interrompu' }[j.state] || j.state;
  return el('article', { class: 'ma-card run' + (echec ? ' err' : '') },
    el('div', { class: 'ma-im', style: j.thumb ? { backgroundImage: `url(${href(j.thumb)})` } : null },
      el('span', { class: 'kind portail' }, etat)),
    el('div', { class: 'ma-body' },
      el('div', { class: 'ma-t' }, p.titre || p.nom || j.title),
      el('div', { class: 'ma-s' }, [p.url ? 'YouTube' : 'bibliothèque', p.langue, p.nom ? 'runs/' + p.nom : ''].filter(Boolean).join(' · ')),
      j.state === 'running' || j.state === 'queued'
        ? el('div', { class: 'ma-bar' }, el('i', { style: { width: `${Math.round((j.progress || 0) * 100)}%` } })) : null,
      el('div', { class: 'ma-msg' + (echec ? ' err' : '') }, j.message || ''),
      el('div', { class: 'row' },
        fini && j.result && j.result.open ? el('a', { class: 'tb ghost sm', href: href(j.result.open) }, 'Studio') : null,
        j.state === 'queued' || j.state === 'running'
          ? el('button', { class: 'tb ghost sm', type: 'button', onclick: () => jobs.cancel(j.id) }, 'Arrêter') : null,
        echec ? el('button', { class: 'tb ghost sm', type: 'button', title: 'reprend où la chaîne s’est arrêtée', onclick: () => jobs.retry(j.id) }, 'Relancer') : null,
        echec ? el('button', { class: 'tb ghost sm', type: 'button', title: 'retirer de la liste', onclick: () => jobs.forget(j.id) }, '×') : null)));
}

let travaux = [];
function peint() {
  const faites = new Set(S.analyses.map((a) => a.id));
  // les travaux actifs, et les échecs récents ; un travail fini dont l'analyse est déjà dans la liste n'a plus de carte
  const enCours = travaux.filter((j) => j.kind === 'analyse.run' &&
    (['queued', 'running', 'error', 'cancelled', 'interrupted'].includes(j.state) || (j.state === 'done' && !faites.has((j.params || {}).nom))));
  // nos films (le dépôt, déjà faits) en tête et en grand ; celles lancées d'ici, et les travaux, dessous
  const films = S.analyses.filter((a) => a.source === 'depot'), ici = S.analyses.filter((a) => a.source !== 'depot');
  const fb = $('#films');
  fb.replaceChildren(...films.map(carteFilm));
  if (!films.length) fb.append(el('p', { class: 'lbl' }, 'aucun film dans analyse/analyses/'));
  const dFilms = films.reduce((s, a) => s + (a.chiffres?.duree || 0), 0);
  $('#n-films').textContent = `${films.length} film${films.length > 1 ? 's' : ''} · ${films.reduce((s, a) => s + (a.chiffres?.plans || 0), 0)} plans · ${fmtDur(dFilms)}`;
  const box = $('#analyses');
  box.replaceChildren(...enCours.map(carteTravail), ...ici.map(carte));
  if (!box.children.length) {
    box.append(el('p', { class: 'ma-note' }, 'Aucune pour l’instant. « Nouvelle analyse » en lance une sur ',
      S.chaine?.machine || 'DGX2', ' : elle arrive ici, dans la même page du portail que nos films — Studio, Casting, Dépouillement.'));
  }
  const n = S.analyses.length;
  $('#n-analyses').textContent = `${ici.length} analyse${ici.length > 1 ? 's' : ''}${enCours.length ? ` · ${enCours.length} travail en cours` : ''}`;
  const plans = S.analyses.reduce((s, a) => s + (a.chiffres?.plans || 0), 0);
  const duree = S.analyses.reduce((s, a) => s + (a.chiffres?.duree || 0), 0);
  const voix = S.analyses.filter((a) => a.chiffres?.voix).length;
  $('#somme').replaceChildren(
    el('dt', {}, 'analyses'), el('dd', { class: 'big' }, String(n)),
    el('dt', {}, 'plans'), el('dd', {}, String(plans)),
    el('dt', {}, 'durée'), el('dd', {}, fmtDur(duree)),
    el('dt', {}, 'avec les voix'), el('dd', {}, `${voix} sur ${n}`),
    el('dt', {}, 'en cours'), el('dd', {}, enCours.filter((j) => j.state === 'running' || j.state === 'queued').length ? 'une analyse' : 'rien'));
}

jobs.watch((list) => { travaux = list.filter((j) => j.tool === 'analyse'); peint(); });
document.addEventListener('sr:job', (e) => {
  const j = e.detail;
  if (j.kind !== 'analyse.run') return;
  if (j.state === 'done') { toast(`« ${j.params?.titre || j.params?.nom} » est prête : Studio sur sa carte`); chargeAnalyses(); }
  else if (j.state === 'error') toast('l’analyse s’est arrêtée : le message est sur sa carte');
});

// ── la diarisation ──────────────────────────────────────────
async function chargeDiar() {
  const box = $('#diar');
  let d;
  try { d = await api('analyse/diarisation'); } catch (e) { box.replaceChildren(el('p', { class: 'warn' }, e.message)); return; }
  const ouvrir = el('div', { class: 'row' },
    el('a', { class: 'tb ghost', href: './diarisation/' }, 'Ouvrir la diarisation'),
    el('a', { class: 'tb ghost', href: './diarisation/?projet=getaround' }, 'La démo Getaround'));
  if (d.up) {
    $('#diar-cnt').textContent = d.pret ? 'prête' : (d.phase || 'répond');
    box.replaceChildren(
      el('div', { class: 'ma-diar-t' },
        el('span', { class: 'pill ' + (d.pret ? 'on' : 'work') }, el('i'), el('span', {}, `${d.machine || 'dgx1'} · ${d.pret ? 'prêt' : d.phase}`)),
        el('p', {}, 'Nemotron 3 Diarization : qui parle, quand, jusqu’à huit voix, chevauchements compris. La page envoie un son ou un film au service ',
          el('code', {}, d.url), ' par le relais du portail — pas besoin de Tailscale sur ce poste.'),
        el('dl', { class: 'kv' },
          el('dt', {}, 'modèle'), el('dd', {}, d.modele || '—'),
          el('dt', {}, 'machine'), el('dd', {}, [d.machine, d.appareil].filter(Boolean).join(' · ') || '—'),
          el('dt', {}, 'voix'), el('dd', {}, nb(d.voix)),
          el('dt', {}, 'transcription'), el('dd', {}, d.transcription ? 'possible (Whisper sur la machine)' : 'non'),
          el('dt', {}, 'file'), el('dd', {}, d.file ? `${d.file.en_cours ? 'un calcul en cours' : 'libre'} · ${d.file.attente || 0} en attente` : '—'))),
      ouvrir);
  } else {
    $('#diar-cnt').textContent = 'ne répond pas';
    box.replaceChildren(
      el('div', { class: 'ma-diar-t' },
        el('span', { class: 'pill err' }, el('i'), el('span', {}, 'le service ne répond pas')),
        el('p', {}, 'Le portail n’atteint pas ', el('code', {}, d.url), ' (', d.why, '). La page s’ouvre quand même : la démo Getaround, un résultat enregistré, les exports. Pour calculer, il faut le service :'),
        el('ul', { class: 'ma-list' }, ...(d.remedes || []).map((r) => el('li', {}, r)))),
      ouvrir);
  }
}

// ── les projets du dépôt partagé ────────────────────────────
async function chargeProjets() {
  const box = $('#projets');
  let r;
  try { r = await api('analyse/projets'); } catch (e) { box.replaceChildren(el('p', { class: 'warn' }, e.message)); return; }
  const lecture = el('p', { class: 'ma-note' }, 'Les projets créés depuis la home de MOVIE_ANALYSE, lus dans son dépôt partagé (',
    el('code', {}, r.source), '). Ici en lecture seule : le Worker n’accepte d’écrire que depuis calculment0r.github.io et le poste.');
  if (r.etat !== 'partage') {
    $('#n-projets').textContent = 'injoignable';
    box.replaceChildren(el('p', { class: 'warn' }, 'le dépôt partagé ne répond pas : ' + r.erreur), lecture);
    return;
  }
  $('#n-projets').textContent = `${r.projets.length} projet${r.projets.length > 1 ? 's' : ''} créé${r.projets.length > 1 ? 's' : ''}`;
  const lignes = r.projets.map((p) => el('div', { class: 'ma-proj' },
    el('b', {}, p.nom || p.id), el('span', { class: 'lbl' }, p.id), el('span', { class: 'sp' }),
    el('span', { class: 'lbl' }, p.cree ? 'créé le ' + fmtDate(p.cree) : ''),
    el('a', { class: 'tb ghost sm', href: './diarisation/?projet=' + encodeURIComponent(p.id) }, 'Voix')));
  box.replaceChildren(...[
    ...(lignes.length ? lignes : [el('p', { class: 'lbl' }, 'aucun projet créé — les analyses du dépôt ci-dessus sont les projets publiés')]),
    r.retires && r.retires.length ? el('p', { class: 'lbl' }, 'retirées de la home de MOVIE_ANALYSE : ' + r.retires.join(', ')) : null,
    lecture].filter(Boolean));
}

// ── la chaîne ───────────────────────────────────────────────
async function chargeChaine() {
  const box = $('#chaine');
  try { S.chaine = await api('analyse/chaine'); } catch (e) { box.replaceChildren(el('p', { class: 'warn' }, e.message)); majLancer(); return; }
  const c = S.chaine;
  $('#nv-machine').textContent = c.machine;
  $('#chaine-cnt').textContent = c.pret ? `prête · ${c.machine}` : 'incomplète';
  const rb = c.reelbench || {};
  const retard = rb.compare && (rb.differe.length || rb.absents.length)
    ? `${rb.chemin} est en retard sur cette copie : ${rb.differe.length} fichier(s) diffèrent (${rb.differe.join(', ')}), ${rb.absents.length} manquent`
    : rb.compare ? `${rb.chemin} : identique à cette copie` : '';
  box.replaceChildren(...[
    el('dl', { class: 'kv ma-kv' },
      el('dt', {}, 'machine'), el('dd', {}, `${c.machine} · voie analyse, une à la fois${c.scope ? ' · mémoire plafonnée (systemd-run)' : ' · nice seul (systemd-run --user indisponible)'}`),
      el('dt', {}, 'la chaîne'), el('dd', {}, c.skill + (c.copie_du_depot ? ' — la copie du dépôt (MOVIE_ANALYSE, voir PROVENANCE.md)' : '')),
      el('dt', {}, 'le travail'), el('dd', {}, c.runs + '/<nom>/'),
      retard ? el('dt', {}, 'reelbench') : null, retard ? el('dd', {}, retard) : null),
    el('ul', { class: 'ma-outils' }, ...c.outils.map((o) => el('li', { class: o.ok ? 'ok' : o.requis ? 'err' : 'opt', title: o.chemin },
      el('i'), el('span', {}, o.nom), el('span', { class: 'lbl' }, o.ok ? 'là' : o.requis ? 'manque' : 'absent · ' + (o.pour || 'facultatif'))))),
    el('p', { class: 'ma-note' }, 'La chaîne tourne en local, rien ne part chez un fournisseur. Chaque étape reprend ce qui existe déjà : relancer une analyse arrêtée repart de là où elle en était.')]);
  const langs = $('#nv-langue');
  langs.replaceChildren(...Object.entries(c.langues || { fr: 'français' }).map(([k, v]) =>
    el('button', { class: 'opt' + (k === S.langue ? ' on' : ''), type: 'button', onclick: () => { S.langue = k; $$('.opt', langs).forEach((b) => b.classList.toggle('on', b.textContent.startsWith(v))); } }, v)));
  majLancer();
}

// ── nouvelle analyse ────────────────────────────────────────
const slug = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
const ytId = (u) => { const m = /(?:[?&]v=|youtu\.be\/|shorts\/|live\/)([A-Za-z0-9_-]{6,20})/.exec(u || ''); return m ? m[1] : ''; };
const estYt = (u) => /^https:\/\/(www\.|m\.)?(youtube\.com\/(watch\?|shorts\/|live\/)|youtu\.be\/)/i.test(u || '');

function nomCourant() {
  if (S.source === 'yt') return ytId($('#nv-url').value.trim());
  return $('#nv-nom').value.trim();
}

let nomT;
function verifieNom() {
  clearTimeout(nomT);
  const nom = nomCourant();
  if (!nom || nom === S.nomVu) return majLancer();
  nomT = setTimeout(async () => {
    try { S.nomLibre = await api('analyse/nom/' + encodeURIComponent(nom)); S.nomVu = nom; }
    catch (e) { S.nomLibre = { nom, erreur: e.message }; S.nomVu = nom; }
    majLancer();
  }, 250);
}

function pourquoi() {
  if (!S.chaine) return 'lecture de la chaîne';
  if (!S.chaine.pret) return 'la chaîne n’est pas prête : ' + S.chaine.outils.filter((o) => o.requis && !o.ok).map((o) => o.nom).join(', ') + ' — voir « La chaîne » plus bas';
  if (S.source === 'bib' && !S.video) return 'choisir une vidéo de la bibliothèque, ou la déposer';
  const url = $('#nv-url').value.trim();
  if (S.source === 'yt') {
    if (!url) return 'coller une adresse YouTube';
    if (!estYt(url) || !ytId(url)) return 'une adresse YouTube : youtube.com/watch?v=…, youtu.be/…';
    if (!S.chaine.outils.find((o) => o.nom === 'yt-dlp')?.ok) return 'yt-dlp manque sur ' + S.chaine.machine;
  }
  if (S.source === 'bib' && !$('#nv-titre').value.trim()) return 'il faut un titre';
  const nom = nomCourant();
  if (S.source === 'bib' && !/^[a-z0-9][a-z0-9-]{0,47}$/.test(nom)) return 'le dossier : minuscules, chiffres et tirets';
  const L = S.nomLibre;
  if (!L || L.nom !== nom) return 'vérification du dossier';
  if (L.erreur) return L.erreur;
  if (!L.libre && !(L.reprendre && $('#nv-reprendre').checked)) {
    return L.reprendre ? `runs/${nom}/ existe (lancée d’ici) : cocher « reprendre », ou changer le titre`
      : `runs/${nom}/ existe déjà et n’a pas été lancé d’ici : on n’y touche pas — changer le titre`;
  }
  return '';
}

function majLancer() {
  const L = S.nomLibre;
  $('#nv-rep-champ').hidden = !(L && L.nom === nomCourant() && !L.libre && L.reprendre);
  const why = pourquoi();
  $('#nv-why').textContent = why;
  $('#nv-lancer').disabled = !!why;
  const top = S.chaine && !S.chaine.pret ? 'la chaîne n’est pas prête : voir « La chaîne »' : '';
  $('#why-nouvelle').hidden = !top; $('#why-nouvelle').textContent = top;
}

function ouvre() {
  $('#nv').hidden = false;
  majLancer();
  (S.source === 'yt' ? $('#nv-url') : $('#nv-titre')).focus();
}
function ferme() { $('#nv').hidden = true; }

$('#nouvelle').onclick = ouvre;
$$('[data-ferme]').forEach((b) => (b.onclick = ferme));
$('#nv').addEventListener('click', (e) => { if (e.target.id === 'nv') ferme(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#nv').hidden && !$('.picker')) ferme(); });

$$('#nv-src .tb').forEach((b) => (b.onclick = () => {
  S.source = b.dataset.src;
  $$('#nv-src .tb').forEach((x) => x.classList.toggle('on', x === b));
  $('#nv-bib').hidden = S.source !== 'bib';
  $('#nv-yt').hidden = S.source !== 'yt';
  $('#nv-nom-champ').hidden = S.source !== 'bib';
  S.nomVu = ''; verifieNom(); majLancer();
}));

function prendVideo(it) {
  if (!it) return;
  S.video = it;
  $('#nv-video').replaceChildren(thumb(it, { onclick: () => $('#nv-choisir').click() }));
  $('#nv-choisir').textContent = 'Changer de vidéo';
  if (!$('#nv-titre').value.trim()) $('#nv-titre').value = it.title || '';
  if (!$('#nv-nom').dataset.touche) $('#nv-nom').value = slug($('#nv-titre').value);
  verifieNom(); majLancer();
}
$('#nv-choisir').onclick = async () => {
  const [it] = await pick({ kinds: ['video'], title: 'Une vidéo à dépouiller' });
  prendVideo(it);
};
// La règle de Cal (29/09) : tout bloc qui attend un asset accepte un dépôt — une vidéo du disque (elle entre dans la
// bibliothèque, catégorie Upload, via « analyse ») ou une vignette glissée d'ailleurs dans le portail.
dropZone($('#nv-bib'), { kinds: ['video'], multiple: false, via: 'analyse', onitems: ([it]) => prendVideo(it) });
$('#nv-titre').oninput = () => {
  if (S.source === 'bib' && !$('#nv-nom').dataset.touche) $('#nv-nom').value = slug($('#nv-titre').value);
  verifieNom(); majLancer();
};
$('#nv-nom').oninput = () => { $('#nv-nom').dataset.touche = $('#nv-nom').value ? '1' : ''; verifieNom(); majLancer(); };
$('#nv-url').oninput = () => { verifieNom(); majLancer(); };
$('#nv-reprendre').onchange = majLancer;
$('#nv-sceneflow').onclick = () => {
  S.sceneflow = !S.sceneflow;
  $('#nv-sceneflow').classList.toggle('on', S.sceneflow);
  $('#nv-sceneflow').setAttribute('aria-pressed', String(S.sceneflow));
};

$('#nv-lancer').onclick = async () => {
  if (pourquoi()) return;
  const corps = { titre: $('#nv-titre').value.trim(), langue: S.langue, sceneflow: S.sceneflow, reprendre: $('#nv-reprendre').checked };
  if (S.source === 'bib') Object.assign(corps, { item: S.video.id, nom: nomCourant() });
  else corps.url = $('#nv-url').value.trim();
  $('#nv-lancer').disabled = true;
  try {
    const j = await api('analyse/run', { method: 'POST', body: corps });
    ferme();
    toast(`« ${j.params.titre || j.params.nom} » en file : elle démarre quand ${S.chaine?.machine || 'la machine'} est libre`);
    jobs.poll(true);
    S.nomVu = ''; S.nomLibre = null;
  } catch (e) {
    $('#nv-why').textContent = e.message;
    $('#nv-lancer').disabled = false;
  }
};

chargeAnalyses();
chargeDiar();
chargeProjets();
chargeChaine();
setInterval(() => { if (!document.hidden) chargeDiar(); }, 30000);
