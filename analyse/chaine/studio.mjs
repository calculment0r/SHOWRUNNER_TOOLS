#!/usr/bin/env node
/**
 * STUDIO — une seule page MOVIE ANALYSIS qui rassemble tout, DANS LE PORTAIL
 * (Showrunner Tools, 29/09 : Cal ne veut plus des pages autonomes à part) :
 *
 *   La page vit sous analyse/analyses/<film>/ ou analyse/runs/<nom>/ (toujours deux
 *   dossiers sous analyse/) ; elle charge le thème du portail (commun/tokens.css,
 *   base.css, shell.css), l'en-tête commun (commun/shell.js par analyse/film/film.js)
 *   et sa propre feuille, analyse/film/film.css — aucune couleur ni police écrite
 *   dans la page. Sombre seulement : le portail n'a pas de bascule.
 *
 *   ┌ en-tête du portail ─────────────────────────────────────────────────┐
 *   ├ ← Les films · titre   [ Studio | Casting | Dépouillement ]  Voix ↗   ┤
 *   ├ scène ───────────────────────────────┬ scénario ───────────────────┤
 *   │ la vidéo analysée, timecode, plan    │ le film écrit comme un script │
 *   │ courant                              │ (plans, actions, répliques),  │
 *   │                                      │ qui défile et se surligne     │
 *   ├ timeline ────────────────────────────┴───────────────────────────────┤
 *   │ Plans · Caméra · Dialogue · Personnages · Rythme — fenêtre glissante, │
 *   │ tête de lecture à 35 %, zoom 8/16/32 s ou tout le film, clic = saut  │
 *   ├ le plan ─────────────────────────────────────────────────────────────┤
 *   │ première/dernière image + silhouettes SAM 3, et TOUT ce qu'on sait   │
 *   │ du plan : échelle, catégorie, mouvement, motion mesurée, transition,  │
 *   │ durée, rythme, sujets (portraits), part d'image, texte, répliques    │
 *   └──────────────────────────────────────────────────────────────────────┘
 *   L'onglet Dépouillement = la table des plans (filtres, accordéon, CSV), et ce que
 *   montrait le rapport-liste de la chaîne (video-shots render) : les chiffres, la
 *   bande de rythme, les répartitions et les portes qualité — dans la page, plus dans
 *   un cadre ni dans une page à part. ?vue=casting|depouillement ouvre sur la vue.
 *
 *   node studio.mjs shots.json --video wall.mp4 --frames frames --overlays overlays \
 *        --portraits portraits [--track track.json] -o index.html
 *
 * Tout est embarqué (images) sauf la vidéo, servie à côté du fichier. #S03 dans
 * l'adresse ouvre le studio sur ce plan. --video-url https://…/video : la vidéo et
 * les pistes de son prises sur R2 (<url>/<slug>/<fichier>), celles d'à côté en repli.
 * (--report et --css, de la page autonome d'avant, sont acceptés et ignorés.)
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as CASTING from './casting-parts.mjs';
// les portes qualité, calculées comme le rapport de la chaîne les calculait (même fonction, mêmes libellés)
import { validate } from './video-shots.mjs';

const [file, ...rest] = process.argv.slice(2);
const flag = (n, d = null) => { const i = rest.indexOf(n); return i < 0 ? d : rest[i + 1]; };
if (!file) { console.error('usage: studio.mjs shots.json --video v.mp4 [--video-url https://…/video] [--frames dir] [--overlays dir] [--portraits dir] [--track track.json] -o index.html'); process.exit(1); }

const doc = JSON.parse(readFileSync(file, 'utf8'));
const video = flag('--video', doc.source ?? 'video.mp4');
const dirs = { frames: flag('--frames', 'frames'), overlays: flag('--overlays', 'overlays'), portraits: flag('--portraits', 'portraits') };
// Cle de memorisation des noms corriges : un dossier d'analyse = un casting.
const slug = flag('--slug', basename(video).replace(/\.[^.]+$/, ''));
// La page est TOUJOURS deux dossiers sous analyse/ (analyses/<film>/ ou runs/<nom>/) : le portail et l'outil
// sont donc aux mêmes chemins relatifs, où qu'elle soit publiée.
const PORTAIL = '../../../', OUTIL = '../../';
// --titre : le titre affiché (la barre du film, l'onglet), quand celui du document n'a pas ses accents
// (« Evadez-vous avec Getaround » dans shots.json, « Évadez-vous… » dans portail.json) ; les données ne changent pas
const TITRE = flag('--titre', null);
// Les voix : la diarisation gardee pour ce film (Nemotron, format xverse-diarisation) et les mots horodates de la
// chaine (whisper.json → mots.json). Sans elles, la timeline suit l'attribution de la chaine, en bloc.
const ICI = dirname(fileURLToPath(import.meta.url));
const lisJson = (p) => (p && existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const diarDoc = lisJson(flag('--diarisation', 'diarisation.json'));
const diar = diarDoc ? (diarDoc.resultat || diarDoc) : null;
const VOIX = {
  slug,
  diar: diar ? { probas: diar.probas, enveloppe: diar.enveloppe, modele: diar.modele, machine: diar.machine, date: diar.date, latence_s: diar.latence_s, reglages: diar.reglages } : null,
  mots: lisJson(flag('--mots', 'mots.json')),
  // portail Showrunner : le labo est analyse/diarisation/, la page analyse/analyses/<film>/ ou analyse/runs/<nom>/
  labo: '../../diarisation/?projet=' + encodeURIComponent(slug),
};
// Le son (son.json, pose a cote) : la VO et ses doublages, chacun en fond + une piste de voix par personnage (son.js).
VOIX.son = lisJson(flag('--son', 'son.json'));
const VOIX_JS = readFileSync(join(ICI, 'voix.js'), 'utf8').replace(/\r\n/g, '\n');
const SON_JS = readFileSync(join(ICI, 'son.js'), 'utf8').replace(/\r\n/g, '\n');
// (voix.css, la feuille de la page autonome, n'est plus posée : analyse/film/film.css porte ces styles dans le thème du portail)

// Les corrections faites dans le trombinoscope — noms, fiches reconnues comme une
// seule personne, repliques retouchees — vivent a cote de la page. On les relit ICI,
// a chaque rendu : une correction survit donc a une regeneration sans qu'on ait le
// moindre script a relancer. Elle est posee AVANT tout le reste, pour que le casting,
// le scenario, la timeline et le depouillement partent tous du meme document.
const corrFile = flag('--corrections', 'corrections.json');
// Ou publier les corrections quand la page est servie en ligne : un hebergement
// statique n'ecrit rien, mais l'API GitHub accepte d'etre appelee depuis le
// navigateur. Le jeton n'est pas ici — l'utilisateur le fournit dans la page.
const depot = flag('--depot', null);                       // « proprietaire/depot »
const branche = flag('--branche', 'main');
const cheminCorr = flag('--chemin', depot ? `analyses/${slug}/corrections.json` : null);
// Le depot des corrections joignable depuis n'importe ou, sans jeton : la page en
// ligne y lit et y ecrit. Une page servie est telechargee par le navigateur — y
// mettre un jeton reviendrait a le donner a quiconque a le lien.
const corrUrl = flag('--corrections-url', null);
// Ou la page prend la video et les pistes de son : sur R2 (le Worker du depot partage, GET /video/<film>/<chemin>),
// GitHub Pages n'etant pas fait pour servir de la video. Le fichier pose a cote de la page reste le repli si R2 ne
// repond pas. Sans --video-url, tout se lit a cote de la page, comme avant.
const mediaUrl = flag('--video-url', null);
const MEDIA = mediaUrl && !/^[a-z]+:|^\//i.test(video) ? mediaUrl.replace(/\/$/, '') + '/' + encodeURIComponent(slug) + '/' : null;
if (existsSync(corrFile)) {
  const corr = JSON.parse(readFileSync(corrFile, 'utf8'));
  // Temoin : le fichier garde les pistes de chaque fiche au moment ou il a ete ecrit.
  // Si la chaine a renumerote depuis, la correction ne designe plus la meme personne
  // et se taire serait pire que tout.
  for (const [id, pistes] of Object.entries(corr.pistes ?? {})) {
    const c = (doc.cast ?? []).find((x) => x.id === id);
    if (c && String(c.tracks ?? '') !== String(pistes)) {
      process.stderr.write(`   ⚠ corrections : ${id} ne porte plus les mêmes pistes (${pistes} → ${c.tracks}) — à revérifier\n`);
    }
  }
  const avant = (doc.cast ?? []).length;
  CASTING.appliqueCorrections(doc, corr);
  process.stderr.write(`   corrections : ${Object.keys(corr.noms ?? {}).length} nom(s), ${Object.keys(corr.fusions ?? {}).length} fusion(s), ${Object.keys(corr.repliques ?? {}).length} réplique(s) — ${avant} → ${(doc.cast ?? []).length} fiches\n`);
}

const b64 = (p) => (existsSync(p) ? `data:image/jpeg;base64,${readFileSync(p).toString('base64')}` : null);
const FRAMES = {}, OVERLAYS = {}, PORTRAITS = {};
for (const s of doc.shots) {
  for (const x of ['a', 'b']) { const u = b64(join(dirs.frames, `${s.id}${x}.jpg`)); if (u) FRAMES[s.id + x] = u; }
  const o = b64(join(dirs.overlays, `${s.id}.jpg`)); if (o) OVERLAYS[s.id] = o;
}
for (const c of doc.cast ?? []) { const u = b64(c.portrait && existsSync(c.portrait) ? c.portrait : join(dirs.portraits, `${c.id}.jpg`)); if (u) PORTRAITS[c.id] = u; }

// Les polices et les couleurs ne sont plus dans la page : ce sont celles du portail (commun/base.css,
// commun/tokens.css), et les teintes des personnages, des voix et du rythme sont déclarées une fois, dans
// analyse/film/film.css, que le script de la page lit à l'exécution.

// Les portes qualité du rapport de la chaîne (video-shots.mjs validate), sur le document corrigé — celui que
// le dépouillement publié montrait (corriger.mjs puis render) ; --track ajoute la porte du mouvement mesuré.
const PORTES = (() => {
  const ctx = { lang: doc.lang ?? null, frameDir: dirs.frames, frameRel: dirs.frames, frameExists: {} };
  if (existsSync(dirs.frames)) for (const f of readdirSync(dirs.frames)) { const m = /^(S\d+[ab])\.jpg$/.exec(f); if (m) ctx.frameExists[m[1]] = true; }
  const trk = flag('--track', null);
  if (trk && existsSync(trk)) ctx.track = JSON.parse(readFileSync(trk, 'utf8'));
  try {
    const v = validate(doc, ctx);
    return { gates: v.gates.map((g) => ({ id: g.id, label: g.label, ok: g.ok, skipped: g.skipped || '', issues: g.issues })), hints: v.hints, track: !!ctx.track };
  } catch (e) { process.stderr.write(`   portes : ${e.message}\n`); return null; }
})();

/* ------------------------------------------------------------- libellés -- */
const L = {
  sizes: { none: 'sans échelle', 'extreme-wide': 'plan général', wide: "plan d'ensemble", 'medium-wide': 'plan moyen', medium: 'plan américain', 'medium-close': 'plan rapproché', close: 'gros plan', 'extreme-close': 'très gros plan' },
  cats: { establishing: "plan d'exposition", subject: 'sujet', dialogue: 'dialogue', reaction: 'réaction', insert: 'insert', pov: 'vue subjective', empty: "plan d'ambiance", product: 'plan produit', 'text-card': 'carton', transition: 'plan de transition', archive: "images d'archive" },
  cams: { static: 'fixe', 'push-in': 'travelling avant', 'pull-out': 'travelling arrière', 'zoom-in': 'zoom avant', 'zoom-out': 'zoom arrière', 'pan-left': 'panoramique gauche', 'pan-right': 'panoramique droite', 'tilt-up': 'panoramique vertical haut', 'tilt-down': 'panoramique vertical bas', 'truck-left': 'travelling latéral gauche', 'truck-right': 'travelling latéral droite', 'pedestal-up': 'montée verticale', 'pedestal-down': 'descente verticale', tracking: "travelling d'accompagnement", arc: 'travelling circulaire', 'whip-pan': 'filé', handheld: "caméra à l'épaule", shake: 'secousses', 'rack-focus': 'changement de point', 'micro-push': 'micro-travelling avant', roll: 'rotation', drone: 'drone' },
  trans: { cut: 'coupe franche', dissolve: 'fondu enchaîné', 'fade-in': 'ouverture en fondu', 'fade-out': 'fermeture en fondu', whip: 'coupe filée', 'match-cut': 'raccord graphique', wipe: 'volet', morph: 'transition truquée' },
  rhythms: { hook: 'accroche', setup: 'mise en place', build: 'montée', beat: 'accent', turn: 'bascule', payoff: 'récompense', breath: 'respiration', close: 'chute' },
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tc = (s) => { const m = Math.floor(s / 60); return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(2).padStart(5, '0')}`; };
const castName = (id) => (doc.cast ?? []).find((c) => c.id === id)?.name ?? id;
const castIndex = Object.fromEntries((doc.cast ?? []).map((c, i) => [c.id, i]));

/* --------------------------------------------------------------- le script -- */
// Le scenario est desormais dessine DANS la page, depuis DATA, comme la timeline et
// la fiche de plan. Fige a la generation, il ne suivait pas les corrections : on
// renommait un personnage et le scenario continuait de l'appeler par son ancien nom.
// L'action du plan n'y figure plus non plus — elle coupait la lecture du dialogue et
// se trouve deja sous la video, dans la fiche du plan.

/* ---------------------------------------------------------------- la page -- */
const DATA = {
  title: doc.title ?? '', video, duration: doc.meta?.durationSeconds ?? doc.shots.at(-1)?.end ?? 0,
  // `tracks` voyage avec la fiche : c'est le temoin qu'un corrections.json enregistre
  // depuis la page emporte avec lui, pour qu'un rendu ulterieur puisse dire si la
  // chaine a renumerote entre-temps.
  meta: doc.meta ?? {}, cast: (doc.cast ?? []).map((c) => ({ id: c.id, name: c.name, note: c.note ?? '', by: c.by ?? '', tracks: c.tracks ?? [], absorbees: c.absorbees ?? [] })),
  shots: doc.shots.map((s) => ({ id: s.id, teinte: s.teinte ?? null, start: s.start, end: s.end, seconds: s.seconds, motion: s.motion, size: s.size, category: s.category, camera: s.camera, transitionIn: s.transitionIn ?? 'cut', subjects: s.subjects ?? [], frame: s.frame ?? '', onscreenText: s.onscreenText ?? '', audio: s.audio ?? '', cards: s.cards ?? null, rhythm: s.rhythm ?? null, rhythmNote: s.rhythmNote ?? '', note: s.note ?? '', masks: s.masks ?? null, lines: s.lines ?? [] })),
  voices: doc.voices ?? null, provenance: doc.provenance ?? {},
  // Ce que le regroupement a ecarte : sans ca, une distribution amputee
  // ressemble a une distribution complete.
  extras: doc.extras ?? [],
};

const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(TITRE || DATA.title)} — Movie Analysis · Showrunner Tools</title>
<meta name="description" content="Le Studio de l'analyse : la vidéo, le script, la timeline des voix, la fiche de chaque plan, le casting et le dépouillement.">
<meta name="sr-forme" content="portail">
<!-- icône vide au chargement : analyse/film/film.js la dessine depuis les jetons -->
<link rel="icon" href="data:,">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&family=Azeret+Mono:wght@300;400;500&display=swap">
<link rel="stylesheet" href="${PORTAIL}commun/tokens.css">
<link rel="stylesheet" href="${PORTAIL}commun/base.css">
<link rel="stylesheet" href="${PORTAIL}commun/shell.css">
<link rel="stylesheet" href="${OUTIL}film/film.css">
<script type="module" src="${OUTIL}film/film.js"></script>
</head>
<body class="film">
<!-- l'en-tête du portail se pose au-dessus (film.js → mountHeader('analyse')) ; dessous, la barre du film -->
<nav class="fm-bar" aria-label="le film">
  <a class="tb ghost sm" href="${OUTIL}" title="Movie Analysis : les projets (nos films, les analyses faites d’ici, les projets créés)">← Projets</a>
  <div class="fm-t"><b>${esc(TITRE || DATA.title)}</b><span class="lbl">${DATA.shots.length} plans · ${tc(DATA.duration).replace(/\.\d+$/, '')} · ${DATA.meta.width ?? '?'}×${DATA.meta.height ?? '?'}</span></div>
  <div class="fm-onglets" id="tabs" role="tablist" aria-label="les vues du film">
    <button type="button" role="tab" data-tab="studio" aria-pressed="true">Studio</button>
    <button type="button" role="tab" data-tab="casting" aria-pressed="false">Casting</button>
    <button type="button" role="tab" data-tab="depouillement" aria-pressed="false">Dépouillement</button>
    <a class="fm-voix" href="${esc(VOIX.labo)}" title="la diarisation Nemotron de ce film, dans le labo : recalculer, direct, micro">Voix <span aria-hidden="true">↗</span></a>
  </div>
  <span class="sp"></span>
  <span class="lbl fm-src" title="${esc(video)}">${MEDIA ? 'vidéo sur R2 · repli à côté' : 'vidéo à côté de la page'}</span>
  <!-- le menu « ⋯ » du portail (commun/menu.js), posé par film.js : la fiche du projet, les vues, les exports, le lien -->
  <span id="fm-plus" data-film="${esc(slug)}"></span>
</nav>

<main id="studio" class="fm-vue">
  <section class="stage-row">
    <div class="player">
      <div class="frise" id="frise"></div>
      <div class="visionneuse" id="visionneuse" data-calque="0">
        <div class="scene">
          <video id="video" src="${esc(MEDIA ? MEDIA + encodeURI(video) : video)}"${MEDIA ? ` data-repli="${esc(video)}"` : ''} preload="metadata" playsinline></video>
          <img id="img-calque" class="calque" alt="">
        </div>
        <div class="hud">
          <span class="g">
            <span class="gros" id="hud-shot">—</span>
            <span class="tc" id="hud-time">00:00.00</span>
          </span>
          <button class="lecture" id="b-lire" aria-pressed="false" title="Lecture (espace)" aria-label="Lecture">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path id="ico" d="M8 5l11 7-11 7z"></path></svg>
          </button>
          <span class="g droite">
            <label id="pick" class="outil" hidden>Choisir la vidéo<input type="file" accept="video/*" hidden></label>
            <button class="outil" id="b-calque" aria-pressed="false">Silhouettes</button>
            <button class="outil ico" id="b-son" title="Couper le son" aria-label="Couper le son"><svg viewBox="0 0 24 24" aria-hidden="true"><path id="ico-son" d="M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"></path></svg></button>
            <button class="outil ico" id="b-plein" title="Plein écran" aria-label="Plein écran"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5v2H6v3H4zm11-5h5v5h-2V6h-3V4zM4 15h2v3h3v2H4v-5zm14 0h2v5h-5v-2h3v-3z"></path></svg></button>
          </span>
        </div>
        <div class="st" id="st"></div>
      </div>
      <!-- L'action du plan, contre la vidéo : on la lit en regardant (retour sous la vidéo le 28/09, moins haute) -->
      <div class="actionnow" id="actionnow"></div>
      <!-- La page voyage sans la vidéo (trop lourde pour un dépôt). Si elle manque,
           on le dit et on propose de charger le fichier depuis le disque du lecteur. -->
      <div class="nofile" id="nofile" hidden>La vidéo ne se lit ni sur R2 ni à côté de cette page. Tout le reste — script, timeline, plans, silhouettes — fonctionne. <label class="link">Charger le fichier depuis ce poste<input type="file" accept="video/*" hidden></label>.</div>
    </div>
    <div class="sep-v" id="sep-cols" title="Glisser : largeur du script · double-clic : par défaut"></div>
    <aside class="script"><div class="script-in">
      <div class="script-head"><span class="lab">Script</span><span class="lab fort">${DATA.shots.length} plans · ${new Set(DATA.shots.flatMap((s) => s.lines.map((l) => `${l.start}-${l.end}`))).size} répliques</span><span class="sp"></span><span class="lab ok" id="script-etat"></span><label class="lab suivre"><input type="checkbox" id="follow" checked> suivre</label></div>
      <div class="script-body" id="script"></div>
    </div></aside>
  </section>
  <!-- tirer vers le haut : la vidéo rétrécit (ses vignettes avec), la timeline grandit ; double-clic : par défaut -->
  <div class="sep-h" id="sep-tl" title="Glisser : taille de la vidéo et de la timeline · double-clic : par défaut"></div>

  <section class="vx" id="tl">
    <div class="vx-tete">
      <span class="lab">Timeline · une piste par personnage</span>
      <span class="aide">chaque mot à son instant · glisser une réplique sur une autre piste pour la réattribuer, ou cliquer dessus</span>
      <span class="sp"></span>
      <span class="etat" id="vx-etat"></span>
      <span class="vx-local" id="vx-local" hidden></span>
      <button class="vx-bouton" id="vx-annuler" type="button" title="Annuler le dernier geste (Ctrl+Z)" disabled>↶ Annuler</button>
      <button class="vx-bouton" id="vx-remise" type="button" title="Défaire toutes les corrections faites dans la page">Tout remettre</button>
      <div class="vx-son" id="vx-son"></div>
      <span class="aide">zoom de la timeline : alt + molette</span>
    </div>
    <div class="vx-corps">
      <div class="vx-noms" id="vx-noms"></div>
      <div class="vx-plot">
        <div class="vx-zone" id="vx-zone"><div class="vx-espace" id="vx-espace"></div></div>
        <canvas id="vx-canvas"></canvas>
        <div class="vx-cue" id="vx-cue"></div>
        <div class="vx-croix" id="vx-croix" hidden></div>
        <div class="vx-bulle" id="vx-bulle" hidden></div>
      </div>
    </div>
    <details class="vx-avance"><summary>Paramètres avancés</summary><div class="corps" id="vx-avance-corps"></div></details>
  </section>

  <section class="shot" id="shot"></section>
</main>

<main id="depouillement" class="fm-vue" hidden>
  <div class="dp">
    <div class="dp-tete">
      <h2 class="fm-h">Dépouillement</h2><span class="lab-s" id="dp-compte">—</span>
      <span class="sp"></span>
      <!-- le sommaire du rapport de la chaîne : ses deux sections sont sous la table -->
      <button class="outil" type="button" data-aller="dp-rep-s">Répartition</button>
      <button class="outil" type="button" data-aller="dp-portes-s" id="dp-aller-portes">Portes qualité</button>
      <button class="outil" id="dp-json" type="button" title="le document tel que la page le montre, corrections comprises">Exporter le JSON</button>
      <button class="outil" id="dp-csv" type="button">Exporter CSV</button>
    </div>
    <!-- le média d'origine, en clair (il était en petit dans le titre du Studio) -->
    <dl class="dp-media">
      <div><dt>Fichier</dt><dd>${esc(video)}</dd></div>
      <div><dt>Durée</dt><dd>${tc(DATA.duration)}</dd></div>
      <div><dt>Définition</dt><dd>${DATA.meta.width ?? '—'} × ${DATA.meta.height ?? '—'} px</dd></div>
      <div><dt>Format</dt><dd>${esc(DATA.meta.aspect ? DATA.meta.aspect.replace(':', ' : ') : '—')}${DATA.meta.width && DATA.meta.height ? ' (' + (DATA.meta.width / DATA.meta.height).toFixed(2).replace('.', ',') + ' : 1)' : ''}</dd></div>
      <div><dt>Images par seconde</dt><dd>${String(DATA.meta.fps ?? '—').replace('.', ',')}</dd></div>
      <div><dt>Codec vidéo</dt><dd>${esc(DATA.meta.codec ?? '—')}</dd></div>
      <div><dt>Son</dt><dd>${DATA.meta.hasAudio === false ? 'aucun' : (DATA.meta.hasAudio ? 'oui' : '—')}</dd></div>
      <div><dt>Plans</dt><dd>${DATA.shots.length}</dd></div>
    </dl>
    <!-- ce que montrait le rapport-liste de la chaîne (video-shots render), calculé ici depuis les mêmes données -->
    <div class="dp-chiffres" id="dp-chiffres"></div>
    <section class="dp-bande">
      <div class="dp-bande-t"><span class="lab">Bande de rythme</span><span class="sp"></span><span class="aide">largeur = durée · couleur = teinte moyenne du plan · clic : le plan dans la table</span></div>
      <div class="dp-segs" id="dp-bande"></div>
      <div class="dp-grad" id="dp-grad"></div>
    </section>
    <div class="etat" id="dp-etat"></div>
    <div class="filtres">
      <input type="search" id="dp-q" placeholder="Chercher dans l'action et les dialogues…" aria-label="Rechercher">
      <div class="jeu" id="dp-cat"></div>
      <select id="dp-role" aria-label="Filtrer par rôle"></select>
      <div class="jeu" id="dp-etats">
        <button data-f="sans-silhouette" aria-pressed="false">Sans silhouette</button>
        <button data-f="personne" aria-pressed="false">Personne identifié</button>
        <button data-f="muet" aria-pressed="false">Muet</button>
        <button data-f="voix-off" aria-pressed="false">Voix off</button>
        <button data-f="court" aria-pressed="false">Sous la seconde</button>
      </div>
      <div class="jeu" id="dp-tri">
        <button data-t="ordre" aria-pressed="true">N°</button>
        <button data-t="duree" aria-pressed="false">Durée</button>
      </div>
    </div>
    <div class="table" id="dp-table"></div>
    <div class="pied-dp">
      <span class="lab-s" id="dp-total">—</span>
      <span class="sp"></span>
      <button class="outil" id="dp-replier" type="button">Tout replier</button>
    </div>
    <div class="dp-deux">
      <section class="dp-pan" id="dp-rep-s" aria-label="répartition">
        <div class="dp-pan-t"><span class="lab">Répartition</span><span class="sp"></span><span class="aide">la part est calculée sur la durée, pas sur le nombre de plans</span></div>
        <p class="dp-note" id="dp-note"></p>
        <div class="dp-dist" id="dp-dist"></div>
      </section>
      <section class="dp-pan" id="dp-portes-s" aria-label="portes qualité">
        <div class="dp-pan-t"><span class="lab">Portes qualité</span><span class="sp"></span><span class="lab-s" id="dp-portes-n"></span></div>
        <div class="dp-portes" id="dp-portes"></div>
      </section>
    </div>
  </div>
</main>
${CASTING.CASTING_SECTION}

<script>
// Le document tel que la chaine l'a rendu. On en garde une copie intacte : rejouer
// les corrections depuis l'origine est la seule facon d'en DEFAIRE une.
const DATA0 = ${JSON.stringify(DATA)};
let DATA = JSON.parse(JSON.stringify(DATA0));
window.XV_DEPOT = ${depot ? JSON.stringify({ depot, branche, chemin: cheminCorr }) : 'null'};
window.XV_CORR_URL = ${corrUrl ? JSON.stringify(corrUrl.replace(/\/$/, '') + '/' + slug + '.json') : 'null'};
// publier sur GitHub : le dépôt partagé (outils/partage) le fait avec son propre jeton — rien à coller dans le navigateur
window.XV_PUBLIER_URL = ${corrUrl ? JSON.stringify(corrUrl.replace(/\/$/, '').replace(/\/corrections$/, '') + '/publier/' + slug) : 'null'};
// Dans le portail, les corrections s'écrivent chez lui (server/tools/analyse.py, /api/analyse/corrections/<film>) : le
// dépôt partagé de MOVIE_ANALYSE refuse l'écriture depuis cette adresse (son worker.js, ligne 18 : ORIGINES ; lignes 142
// et 148 : 403 « origine non autorisée »). La page le lit toujours ; le portail ne garde que sa part.
window.XV_CORR_PORTAIL = ${JSON.stringify(PORTAIL + 'api/analyse/corrections/' + encodeURIComponent(slug))};
window.XV_PARTAGE_REFUS = ${corrUrl ? JSON.stringify('le dépôt partagé de MOVIE_ANALYSE n’accepte d’écriture que depuis calculment0r.github.io et 127.0.0.1 (son worker.js, ligne 18 : ORIGINES ; 403 « origine non autorisée ») — les corrections faites ici sont enregistrées dans le portail, pour tous ceux qui l’ouvrent') : 'null'};
window.XV_PAGE_MA = ${depot ? JSON.stringify('https://' + depot.split('/')[0] + '.github.io/' + depot.split('/')[1] + '/analyses/' + slug + '/') : 'null'};
// la video et les pistes de son sur R2 (--video-url) ; a cote de la page si R2 ne repond pas
window.XV_MEDIA = ${JSON.stringify(MEDIA)};
// les portes qualite du rapport de la chaine, calculees au rendu (video-shots.mjs validate)
const PORTES = ${JSON.stringify(PORTES).replace(/</g, '\\u003c')};
${CASTING.CORRECTIONS_JS}
${CASTING.appliqueNoms(slug)}
const FRAMES = ${JSON.stringify(FRAMES)};
const OVERLAYS = ${JSON.stringify(OVERLAYS)};
const PORTRAITS = ${JSON.stringify(PORTRAITS)};
const L = ${JSON.stringify(L)};
const VOIX = ${JSON.stringify(VOIX).replace(/[⺀-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))};
// Les teintes : celles du portail (commun/tokens.css), et la palette des personnages, des voix et du rythme,
// declaree une seule fois dans analyse/film/film.css. Aucune couleur n'est ecrite dans cette page : on les lit
// (la feuille est chargee avant ce script, qui l'attend). Une palette absente retombe sur l'encre du portail.
const JETON = (() => { const cs = getComputedStyle(document.documentElement); return (n) => cs.getPropertyValue(n).trim(); })();
const PALETTE = (prefixe, n) => { const out = []; for (let i = 0; i < n; i++) { const c = JETON(prefixe + i); if (c) out.push(c); } return out.length ? out : [JETON('--ink2')]; };
const CAST_COLORS = PALETTE('--pc-', 16);
const RHYTHM_COLORS = {};
['hook', 'setup', 'build', 'beat', 'turn', 'payoff', 'breath', 'close'].forEach((k) => { RHYTHM_COLORS[k] = JETON('--ry-' + k) || JETON('--ink3'); });
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tc = (s) => { const m = Math.floor(s / 60); return String(m).padStart(2, '0') + ':' + (s - m * 60).toFixed(2).padStart(5, '0'); };
const castName = (id) => (DATA.cast.find((c) => c.id === id) || {}).name || id;
const castColor = (id) => CAST_COLORS[Math.max(0, DATA.cast.findIndex((c) => c.id === id)) % CAST_COLORS.length];
// Sur un rail de timeline il ne reste que quelques caracteres. « L'homme aux lunettes
// aviateur » et « L'homme aux yeux bleus » tronques au 13e caractere donnent deux fois
// « L'homme aux… » : deux rails jumeaux, illisibles. On coupe donc la tete de la
// formule — article, « homme/femme », preposition — et on garde ce qui distingue.
const courtNom = (n) => {
  let s = String(n || '').replace(/^(l['’]|la |le |les |un |une )\\s*/i, '').replace(/^(homme|femme|gars|type|personne)\\s+(aux?|à|a|en|avec|qui)\\s+/i, '');
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return s.length > 18 ? s.slice(0, 17) + '…' : s;
};
const video = $('video');
const D = DATA.duration || 1;

/* ── thème : celui du portail, sombre, sans bascule — la page ne pose plus de marque de thème ── */

/* ── onglets ── */
${CASTING.ONGLETS}

/* ── trombinoscope ── */
${CASTING.TROMBINOSCOPE}

/* ── timeline : une bande par piste, translatée à chaque image ── */
const tl = $('tl');
const shotAt = (t) => DATA.shots.find((s) => t >= s.start && t < s.end) || (t >= D ? DATA.shots[DATA.shots.length - 1] : null);
// Une replique est rangee dans chaque plan qu'elle recouvre : ici on ne la veut
// qu'une fois, avec ses bornes reelles.
const repliquesUniques = () => {
  const vu = {}, out = [];
  DATA.shots.forEach((s) => (s.lines || []).forEach((l) => {
    const cle = l.start + '-' + l.end;
    if (!vu[cle]) { vu[cle] = 1; out.push(l); }
  }));
  return out;
};
// Les rails se reconstruisent a chaque correction : un nom change, deux fiches
// n'en font plus qu'une, une replique est retouchee — la timeline doit suivre.
//
// Un rail par personnage : sa PRESENCE est un trait, sa REPLIQUE s'ecrit dessus.
// Il n'y a plus de rail « dialogue » unique — deux personnes qui parlent en meme
// temps s'y seraient empilees au meme endroit, illisibles. Les voix qu'aucune
// bouche ne porte ont leur propre rail : elles n'appartiennent a personne.
// Deux rails qui portent la meme etiquette ne servent a rien. « La femme aux cheveux
// courts et lunettes carrees » et « L'homme aux cheveux courts et lunettes carrees »
// se reduisent tous deux a « Cheveux courts et… » : on remet alors ce qui distingue.
const etiquettesRails = (noms) => {
  const base = noms.map(courtNom), compte = {};
  base.forEach((b) => { compte[b] = (compte[b] || 0) + 1; });
  return noms.map((n, i) => {
    if (compte[base[i]] < 2) return base[i];
    // Ce qui distingue est a la FIN du nom — « …et chemise claire » contre
    // « …et chemise foncee » : couper par la tete masquerait justement ca.
    const entier = String(n).replace(/^(l['’]|la |le |les )\s*/i, '');
    const queue = entier.length > 19 ? '…' + entier.slice(-18) : entier;
    return queue;
  });
};
${VOIX_JS}
${SON_JS}
function layout() { rendreTimeline(); paint(video.currentTime || 0, true); }
let lastShot = null, lastLine = null, lastCartes = null;
function paint(t, force) {
  $('hud-time').textContent = tc(t) + ' / ' + tc(D);
  majSousTitre(t);
  majCue(t);
  const s = shotAt(t);
  if (s && (force || s.id !== lastShot)) { lastShot = s.id; $('hud-shot').textContent = s.id; majVerdant(s); dessineAction(s, t); renderShot(s); markScript(s, t); if (window.xvPlanCourant) window.xvPlanCourant(s); if (history.replaceState) history.replaceState(null, '', '#' + s.id); }
  const cles = s ? s.id + ':' + cartonsA(s, t).map((c) => c.t).join(',') : '';
  if (s && cles !== lastCartes) { lastCartes = cles; dessineAction(s, t); }
  const line = s && s.lines.find((l) => t >= l.start && t < l.end);
  const key = line ? line.start + line.text : null;
  if (key !== lastLine) { lastLine = key; markScript(s, t); }
  document.querySelectorAll('#shot .lines div').forEach((el) => el.classList.toggle('now', !!line && el.dataset.k === key));
}

/* ── le scénario : dessiner, surligner, suivre, et corriger une réplique ── */
// Dessine dans la page, depuis DATA : un en-tete technique par plan puis les
// repliques, rien d'autre. L'action du plan est sous la video, dans sa fiche.
// Les marques d'un script, celles qu'on lit dans un vrai scenario. Elles sont la
// pour qu'on sache EXACTEMENT comment lire une ligne : qui parle, s'il enchaine,
// s'il est hors du cadre, si la voix n'appartient a personne.
const TRANSITIONS = { 'fade-in': 'FADE IN:', 'fade-out': 'FADE OUT.', dissolve: 'DISSOLVE TO:', wipe: 'WIPE TO:', 'match-cut': 'MATCH CUT TO:', whip: 'WHIP PAN TO:', morph: 'MORPH TO:' };
function dessineScript() {
  // Une replique qui enjambe un raccord est rangee dans CHAQUE plan qu'elle recouvre
  // — c'est juste pour un depouillement plan par plan, mais a l'ecrit elle se lisait
  // deux fois de suite. Elle n'apparait ici que dans le plan qui en porte le plus.
  const hote = {};
  DATA.shots.forEach((s) => (s.lines || []).forEach((l) => {
    const cle = l.start + '-' + l.end;
    const part = Math.min(l.end, s.end) - Math.max(l.start, s.start);
    if (!hote[cle] || part > hote[cle].part) hote[cle] = { id: s.id, part: part };
  }));
  let precedent = null;   // dernier locuteur : (CONT'D) quand il reprend la parole
  let html = '<div class="sc-trans">FADE IN:</div>';
  DATA.shots.forEach((s) => {
    const cam = s.camera && s.camera !== 'static' ? ' · ' + (L.cams[s.camera] || s.camera) : '';
    const tr = TRANSITIONS[s.transitionIn];
    if (tr && s !== DATA.shots[0]) html += '<div class="sc-trans">' + esc(tr) + '</div>';
    html += '<div class="sc-shot" data-shot="' + s.id + '" id="sc-' + s.id + '">'
      + '<div class="sc-slug"><b>' + s.id + '</b> <span class="mono">' + tc(s.start) + ' → ' + tc(s.end) + '</span> <i>' + esc(L.sizes[s.size] || s.size || '') + esc(cam) + '</i></div>';
    // Un carton s'incruste par-dessus le plan qui continue : il n'a pas de plan a lui,
    // mais un script le porte, avec le moment ou il arrive.
    (s.cards || []).forEach((c) => {
      html += '<div class="sc-carton">CARTON <span class="mono">' + tc(c.t) + '</span> — ' + esc(c.texte) + '</div>';
    });
    (s.lines || []).filter((l) => hote[l.start + '-' + l.end].id === s.id).forEach((l) => {
      // (V.O.) : aucune bouche ne porte cette voix, elle n'est a personne.
      // (O.S.) : on sait qui parle, il n'est pas dans le cadre de ce plan.
      // (CONT'D) : le meme personnage reprend, sans que personne d'autre ait parle.
      let cue, marque = '';
      if (!l.speaker) { cue = 'VOIX OFF'; marque = ' (V.O.)'; }
      else {
        cue = castName(l.speaker).toUpperCase();
        if (!(s.subjects || []).includes(l.speaker)) marque = ' (O.S.)';
        if (precedent === l.speaker) marque += " (CONT'D)";
      }
      html += '<div class="sc-line" data-start="' + l.start + '" data-end="' + l.end + '">'
        + '<div class="sc-who">' + esc(cue) + (marque ? '<small>' + esc(marque) + '</small>' : '') + '</div>'
        + '<div class="sc-say" contenteditable="plaintext-only" spellcheck="false" data-cle="' + l.start + '-' + l.end + '" title="cliquer pour corriger la réplique">' + esc(l.text) + '</div></div>';
      precedent = l.speaker || null;
    });
    html += '</div>';
  });
  $('script').innerHTML = html + '<div class="sc-trans">FADE OUT.</div>';
}
let userScrolled = 0;
$('script').addEventListener('wheel', () => { userScrolled = Date.now(); markScript.cible = null; });
$('script').addEventListener('click', (e) => { if (e.target.closest('.sc-say')) return; const l = e.target.closest('.sc-line'); if (l) { video.currentTime = +l.dataset.start + 0.02; paint(video.currentTime, true); return; } const sh = e.target.closest('.sc-shot'); if (sh) { const s = DATA.shots.find((x) => x.id === sh.dataset.shot); video.currentTime = s.start + 0.02; paint(video.currentTime, true); } });
// Une transcription se trompe. La replique corrigee rejoint corrections.json avec les
// noms et les fusions : meme fichier, meme survie a une regeneration.
// On enregistre pendant la frappe, temporise : la perte de focus ne part pas de facon
// fiable sur un contenteditable (remplacer le texte detruit le noeud qui portait le
// curseur, et l'evenement se perd), et personne ne pense a valider une correction.
let minuteur = null;
$('script').addEventListener('input', (e) => {
  const el = e.target.closest && e.target.closest('.sc-say');
  if (!el) return;
  clearTimeout(minuteur);
  minuteur = setTimeout(() => {
    const cle = el.dataset.cle, txt = el.textContent.replace(/\\s+/g, ' ').trim();
    let avant = null;
    DATA.shots.forEach((s) => (s.lines || []).forEach((l) => { if (l.start + '-' + l.end === cle) avant = l.text; }));
    if (avant === null || !txt || txt === avant) return;
    const c = window.xvCorrections(); c.repliques[cle] = txt; window.xvPoseCorrections(c);
    // part aussitot au depot partage, comme les gestes de la timeline : sinon elle restait dans ce navigateur
    if (window.xvEnregistrePartage) window.xvEnregistrePartage(['repliques'], null);
    DATA.shots.forEach((s) => (s.lines || []).forEach((l) => { if (l.start + '-' + l.end === cle) l.text = txt; }));
    // la timeline et la fiche du plan citent la replique : elles suivent, pas le
    // scenario, ou l'on est en train d'ecrire.
    rendreTimeline(); if (window.xvRendreDecoupage) window.xvRendreDecoupage(); lastShot = null; paint(video.currentTime || 0, true);
    // Dire que c'est enregistre : sans retour, on ne sait pas si la correction a pris.
    const et = $('script-etat');
    if (et) { et.textContent = 'réplique enregistrée'; clearTimeout(et._t); et._t = setTimeout(() => { et.textContent = ''; }, 2600); }
  }, 700);
});
function markScript(s, t) {
  document.querySelectorAll('.sc-shot').forEach((el) => el.classList.toggle('now', !!s && el.dataset.shot === s.id));
  let target = null, suivante = null;
  document.querySelectorAll('.sc-line').forEach((el) => {
    const a = +el.dataset.start, on = t >= a && t < +el.dataset.end;
    el.classList.toggle('now', on);
    if (on) target = el;
    if (!on && a > t && (!suivante || a < +suivante.dataset.start)) suivante = el;
  });
  // Entre deux repliques, on vise la PROCHAINE : viser l'en-tete du plan (au-dessus) faisait remonter le script puis
  // redescendre a chaque silence — desagreable quand on lit. Pendant la lecture, le script ne va plus que vers le bas.
  if (!target) target = suivante || (s && document.getElementById('sc-' + s.id));
  // scrollIntoView fait remonter TOUTE la page des qu'on change de plan. On ne deplace que le panneau du script, sur
  // lui-meme, et seulement quand la cible change (relancer le defilement doux a chaque image le faisait hoqueter).
  if (target && target !== markScript.cible && $('follow').checked && Date.now() - userScrolled > 2500) {
    markScript.cible = target;
    const boite = $('script'), br = boite.getBoundingClientRect(), tr = target.getBoundingClientRect();
    // la replique au tiers haut : on lit la suite dessous
    const y = boite.scrollTop + (tr.top - br.top) - boite.clientHeight * 0.3;
    boite.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  }
}

/* ── l'action du plan, contre la vidéo ──────────────────────────────────────────
   Elle se lit EN REGARDANT : c'est là qu'elle sert, pas dans la fiche trois écrans
   plus bas, et pas dans le scénario où elle coupait le dialogue en deux. */
const cartonsA = (s, t) => (s.cards || []).filter((c) => t >= c.t - 0.1 && t < c.t + 3);
function dessineAction(s, t) {
  const el = $('actionnow'); if (!el) return;
  if (t == null) t = video.currentTime || 0;
  const cartes = cartonsA(s, t);
  el.innerHTML = '<span class="lab">' + esc(s.id) + ' · action</span>'
    + (s.frame ? '<div class="txt" title="' + esc(s.frame) + '">' + esc(s.frame) + '</div>' : '<div class="vide">pas de description sur ce plan</div>')
    + (cartes.length
        ? cartes.map((c) => '<div class="oi">carton ' + tc(c.t) + ' · ' + esc(c.texte) + '</div>').join('')
        : (!(s.cards && s.cards.length) && s.onscreenText ? '<div class="oi">texte à l\\'image : ' + esc(s.onscreenText) + '</div>' : ''));
}

/* ── le plan : tout ce qu'on sait ── */
function renderShot(s) {
  const cell = (lab, val, cls) => '<div class="cell' + (cls ? ' ' + cls : '') + '"><span class="lab">' + lab + '</span><b>' + val + '</b></div>';
  const m = s.motion == null ? '—' : s.motion + (s.motion <= 1.5 ? ' · immobile' : s.motion >= 12 ? ' · très animé' : '');
  const presents = s.subjects.concat(Object.keys(s.masks || {}).filter((id) => !s.subjects.includes(id)));
  const people = presents.map((id) => '<div class="person"><i style="background:' + castColor(id) + '"></i>' + (PORTRAITS[id] ? '<img src="' + PORTRAITS[id] + '" alt="">' : '') + '<span>' + esc(castName(id)) + (s.masks && s.masks[id] ? '<span class="pct">' + s.masks[id].coverage + ' %</span>' : '') + '</span></div>').join('') || '<span class="note">personne rattachée à ce plan</span>';
  const lines = s.lines.map((l) => '<div data-k="' + esc(l.start + l.text) + '"><b>' + esc(l.speaker ? castName(l.speaker) : '?') + '</b>' + esc(l.text) + '</div>').join('');
  $('shot').innerHTML = '<div class="frame-card"><div class="frames">'
    + '<figure style="margin:0"><img src="' + (FRAMES[s.id + 'a'] || '') + '" alt=""><figcaption>Première image · ' + tc(s.start) + '</figcaption></figure>'
    + '<figure style="margin:0"><img src="' + (FRAMES[s.id + 'b'] || '') + '" alt=""><figcaption>Dernière image · ' + tc(s.end) + '</figcaption></figure></div>'
    + '<div class="overlay"><span class="lab">Silhouettes · SAM 3</span>' + (OVERLAYS[s.id] ? '<img src="' + OVERLAYS[s.id] + '" alt="">' : '<div class="none">pas de silhouette rattachée sur ce plan</div>') + '</div></div>'
    + '<div class="info"><h2>' + s.id + ' <span class="mono">' + tc(s.start) + ' → ' + tc(s.end) + ' · ' + s.seconds + ' s</span></h2>'
    + '<p class="desc">' + esc(s.frame) + '</p>'
    + '<div class="grid">' + cell('Échelle', esc(L.sizes[s.size] || s.size || '—')) + cell('Catégorie', esc(L.cats[s.category] || s.category || '—')) + cell('Mouvement', esc(L.cams[s.camera] || s.camera || '—'), s.camera && s.camera !== 'static' ? 'red' : '') + cell('Motion mesurée', '<span class="mono">' + m + '</span>') + cell('Transition', esc(L.trans[s.transitionIn] || s.transitionIn)) + cell('Durée', '<span class="mono">' + s.seconds + ' s</span>')
    + (s.rhythm ? cell('Rythme', '<span class="rh"><i style="background:' + RHYTHM_COLORS[s.rhythm] + '"></i>' + esc(L.rhythms[s.rhythm]) + '</span>') : '') + (s.onscreenText ? cell('Texte à l\\'image', esc(s.onscreenText)) : '') + '</div>'
    + (s.rhythmNote ? '<div class="note">' + esc(s.rhythmNote) + '</div>' : '')
    + '<div><span class="lab">Personnages · part d\\'image</span><div class="people" style="margin-top:6px">' + people + '</div></div>'
    + (lines ? '<div class="lines">' + lines + '</div>' : '')
    + (s.note ? '<div class="note">' + esc(s.note) + '</div>' : '') + '</div>';
}

/* ── la vidéo manque (page publiée sans elle) : on le dit, on propose le disque ── */
function attach(file) {
  if (!file) return;
  video.src = URL.createObjectURL(file);
  $('nofile').hidden = true; $('pick').hidden = true;
  video.addEventListener('loadedmetadata', () => paint(video.currentTime, true), { once: true });
}
// La vidéo « manquante » : SEULEMENT sur une vraie erreur de lecture (video.error). Juger sur networkState au chargement
// était faux : le navigateur passe par NETWORK_NO_SOURCE au tout début de sa recherche de source (norme HTML), et le
// message partait selon la vitesse de la machine alors que la vidéo arrivait (28/09). Une erreur réseau est retentée
// une fois ; dès que la vidéo se charge, le message s'en va.
// La vidéo prise sur R2 (window.XV_MEDIA) qui ne répond pas : on passe au fichier posé à côté de la page (data-repli),
// sans rien dire, et c'est lui qui a droit à la relance.
let relance = false;
const missing = () => {
  if (!video.error) return;
  const repli = video.dataset.repli;
  if (repli && video.getAttribute('src') !== repli && video.src.indexOf('blob:') !== 0) { relance = false; video.src = repli; return; }
  if (!relance && video.error.code === MediaError.MEDIA_ERR_NETWORK) { relance = true; video.load(); return; }
  $('nofile').hidden = false; $('pick').hidden = false;
};
video.addEventListener('error', missing, true);
video.addEventListener('loadedmetadata', () => { $('nofile').hidden = true; $('pick').hidden = true; });
if (video.error) missing();
// un navigateur diffère parfois le chargement (onglet en arrière-plan) : on le relance, sans rien dénoncer
setTimeout(() => { if (video.readyState === 0 && !video.error && video.networkState !== HTMLMediaElement.NETWORK_LOADING) video.load(); }, 2500);
document.querySelectorAll('#nofile input, #pick input').forEach((i) => i.addEventListener('change', (e) => attach(e.target.files[0])));

/* ── lecture : rAF tant que ça joue, sinon sur événements ── */
let raf = null;
const tick = () => { paint(video.currentTime); raf = video.paused ? null : requestAnimationFrame(tick); };
video.addEventListener('play', () => { if (!raf) raf = requestAnimationFrame(tick); });
video.addEventListener('pause', () => { if (raf) cancelAnimationFrame(raf); raf = null; paint(video.currentTime, true); });
video.addEventListener('seeked', () => paint(video.currentTime, true));
video.addEventListener('timeupdate', () => { if (video.paused) paint(video.currentTime); });
// Plus de flèches sous l'image — la frise du dessus fait ce travail. Le clavier reste.
function planPrecedent() { const s = shotAt(video.currentTime); const i = DATA.shots.indexOf(s); const p = DATA.shots[Math.max(0, i - (video.currentTime - (s ? s.start : 0) < 0.6 ? 1 : 0))]; video.currentTime = (p || DATA.shots[0]).start + 0.02; paint(video.currentTime, true); }
function planSuivant() { const s = shotAt(video.currentTime); const i = DATA.shots.indexOf(s); const n = DATA.shots[Math.min(DATA.shots.length - 1, i + 1)]; video.currentTime = n.start + 0.02; paint(video.currentTime, true); }
// On ecrit dans le scenario et dans le trombinoscope : une barre d'espace tapee la
// ne doit pas mettre la video en pause.
document.addEventListener('keydown', (e) => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return; if (e.key === ' ' || e.key === 'k') { e.preventDefault(); video.paused ? video.play() : video.pause(); } if (e.key === 'ArrowLeft' || e.key === 'j') planPrecedent(); if (e.key === 'ArrowRight' || e.key === 'l') planSuivant(); });
// #S03 dans l'adresse : on le lit AVANT le premier rendu (qui réécrit l'adresse),
// on saute au plan dès que la vidéo accepte un seek, et on ne réécrit rien avant.
const wantedHash = location.hash;
const wanted = DATA.shots.find((s) => '#' + s.id === wantedHash);
let pendingSeek = !!wanted;
const _replace = history.replaceState ? history.replaceState.bind(history) : null;
if (_replace) history.replaceState = (a, b, url) => { if (!pendingSeek) _replace(a, b, url); };
window.addEventListener('resize', layout);
/* La disposition : hauteur de la scène (poignée entre la scène et la timeline) et largeur du script (poignée entre la
   vidéo et le script), indépendantes, gardées par ce navigateur. Double-clic sur une poignée : la valeur par défaut. */
(function () {
  const racine = document.getElementById('studio'), CLE = 'movie-analysis-disposition';
  let d = {}; try { d = JSON.parse(localStorage.getItem(CLE) || '{}'); } catch (e) {}
  delete d.hv;   // l'ancien réglage (hauteur de la vidéo seule), remplacé par la hauteur de la scène
  const pose = () => {
    if (d.hs) racine.style.setProperty('--h-scene', d.hs + 'px'); else racine.style.removeProperty('--h-scene');
    if (d.ls) racine.style.setProperty('--l-script', d.ls + 'px'); else racine.style.removeProperty('--l-script');
  };
  const garde = () => { try { localStorage.setItem(CLE, JSON.stringify(d)); } catch (e) {} };
  let rafD = 0;
  const redessine = () => { if (rafD) return; rafD = requestAnimationFrame(() => { rafD = 0; window.dispatchEvent(new Event('resize')); }); };
  const poignee = (id, sens, bouge, defaut) => {
    const el = document.getElementById(id); if (!el) return;
    el.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault(); el.setPointerCapture(ev.pointerId); el.classList.add('actif'); document.body.classList.add('redim', sens);
      const x0 = ev.clientX, y0 = ev.clientY, v0 = bouge.depart();
      const mv = (e) => { bouge.applique(v0, e.clientX - x0, e.clientY - y0); pose(); redessine(); };
      const fin = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', fin); el.removeEventListener('pointercancel', fin);
        el.classList.remove('actif'); document.body.classList.remove('redim', sens); garde(); };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', fin); el.addEventListener('pointercancel', fin);
    });
    el.addEventListener('dblclick', () => { defaut(); pose(); garde(); redessine(); });
  };
  // (redim-h / redim-v : « row » et « col » sont des classes du portail, qui mettaient la page en flex pendant un glisser)
  poignee('sep-tl', 'redim-h', {
    depart: () => document.querySelector('.stage-row').getBoundingClientRect().height,
    applique: (h0, dx, dy) => { d.hs = Math.round(Math.max(380, Math.min(innerHeight * 0.92, h0 + dy))); },
  }, () => { delete d.hs; });
  poignee('sep-cols', 'redim-v', {
    depart: () => document.querySelector('.script').getBoundingClientRect().width,
    // la largeur du script, rien d'autre : la hauteur (la timeline) reste où on l'a posée
    applique: (l0, dx) => { const tot = document.querySelector('.stage-row').getBoundingClientRect().width; d.ls = Math.round(Math.max(240, Math.min(tot * 0.6, l0 - dx))); },
  }, () => { delete d.ls; });
  pose();
})();
rendreTimeline();
dessineScript();
layout();
// le casting s'est dessine plus haut, avant que les voix aient dit qui parle : il recompte
if (typeof window.xvDessineCasting === 'function') window.xvDessineCasting();

/* ── une correction, et tout se redessine ──────────────────────────────────────
   On repart du document d'origine et on rejoue les corrections par-dessus : c'est
   la seule facon d'en retirer une, et ca garantit qu'aucune ne s'applique deux fois
   sur un document deja corrige. */
window.xvRafraichir = () => {
  const t = video.currentTime || 0;
  DATA = JSON.parse(JSON.stringify(DATA0));
  // Le fichier pose a cote de la page est la base commune ; ce que CE navigateur a
  // corrige passe par-dessus — sinon un nom venu du fichier ecraserait la correction
  // qu'on vient de taper.
  const f = window.XV_CORR_FICHIER || {}, l = window.xvCorrections(), m = Object.assign({}, f, l);
  for (const k of ['noms', 'fusions', 'repliques', 'locuteurs', 'voix']) m[k] = Object.assign({}, f[k] || {}, l[k] || {});
  appliqueCorrections(DATA, m);
  rendreTimeline();
  dessineScript();
  layout();
  lastShot = null; lastLine = null;
  paint(t, true);
  if (typeof window.xvDessineCasting === 'function') window.xvDessineCasting();
};

/* Le fichier de corrections pose a cote de la page fait foi pour tout le monde ; la
   memoire du navigateur ne vaut que pour celui qui a corrige. On le lit apres coup :
   un fichier absent (page ouverte depuis le disque, analyse sans correction) ne doit
   surtout pas retarder l'affichage. */
// D'abord le fichier a cote de la page, puis le depot partage s'il y en a un : c'est
// lui qui fait foi entre plusieurs personnes. La memoire du navigateur ne garde que ce qui n'est pas encore
// partage (videe des qu'un envoi est confirme) ; s'il en reste, la page le dit (xvEtatPartage).
(async () => {
  let c = null;
  try { const r = await fetch('corrections.json', { cache: 'no-store' }); if (r.ok) c = await r.json(); } catch (e) {}
  // la version du depot (celle qu'on a relue et commitee) : « Tout remettre » y revient, pas a zero
  window.XV_CORR_DEPOT = c ? JSON.parse(JSON.stringify(c)) : {};
  if (window.XV_CORR_URL) {
    try {
      const r = await fetch(window.XV_CORR_URL, { cache: 'no-store' });
      window.XV_PARTAGE = r.ok ? 'lu' : 'injoignable';
      if (r.ok) {
        const d = await r.json();
        if (d && typeof d === 'object' && (Object.keys(d.noms || {}).length || Object.keys(d.fusions || {}).length || Object.keys(d.repliques || {}).length || Object.keys(d.locuteurs || {}).length || Object.keys(d.voix || {}).length)) {
          c = Object.assign({}, c || {}, d, {
            noms: Object.assign({}, (c || {}).noms || {}, d.noms || {}),
            fusions: Object.assign({}, (c || {}).fusions || {}, d.fusions || {}),
            repliques: Object.assign({}, (c || {}).repliques || {}, d.repliques || {}),
            locuteurs: Object.assign({}, (c || {}).locuteurs || {}, d.locuteurs || {}),
            voix: Object.assign({}, (c || {}).voix || {}, d.voix || {}),
          });
        }
      }
    } catch (e) { window.XV_PARTAGE = 'injoignable'; }
  }
  // puis ce que le portail a gardé (seulement ce qui y a été corrigé), par-dessus, clé par clé
  if (window.XV_CORR_PORTAIL) {
    try {
      const r = await fetch(window.XV_CORR_PORTAIL, { cache: 'no-store', credentials: 'same-origin' });
      window.XV_PORTAIL = r.ok ? 'lu' : 'injoignable';
      if (r.ok) {
        const d = await r.json();
        if (d && typeof d === 'object') {
          c = Object.assign({}, c || {});
          for (const k of ['noms', 'fusions', 'repliques', 'locuteurs', 'voix']) c[k] = Object.assign({}, c[k] || {}, d[k] || {});
        }
      }
    } catch (e) { window.XV_PORTAIL = 'injoignable'; }
  }
  if (c && typeof c === 'object') { window.XV_CORR_FICHIER = c; window.xvRafraichir(); }
  if (typeof window.xvEtatPartage === 'function') window.xvEtatPartage();
})();
if (wanted) {
  const go = () => {
    video.currentTime = wanted.start + 0.02;
    const check = () => { if (Math.abs(video.currentTime - wanted.start) < 0.5) { pendingSeek = false; paint(video.currentTime, true); } else if (video.readyState >= 1) { video.currentTime = wanted.start + 0.02; setTimeout(check, 150); } };
    setTimeout(check, 50);
  };
  video.readyState >= 3 ? go() : video.addEventListener('canplay', go, { once: true });
  paint(wanted.start, true);
} else paint(0, true);
// taper #S12 dans la barre d'adresse (ou coller un lien) saute au plan, sans recharger
window.addEventListener('hashchange', () => {
  const s = DATA.shots.find((x) => '#' + x.id === location.hash);
  if (s && Math.abs(video.currentTime - s.start) > 0.5) { video.currentTime = s.start + 0.02; paint(video.currentTime, true); }
});


/* ══════════════════════════════════════════════════ la vue Verdant ══════ */

/* La frise : toutes les images clés, au-dessus de l'image. */
(function () {
  const z = $('frise'); if (!z) return;
  DATA.shots.forEach((sh) => {
    const b = document.createElement('button');
    b.dataset.shot = sh.id; b.setAttribute('aria-current', 'false');
    b.title = sh.id + ' · ' + tc(sh.start);
    const im = document.createElement('img');
    im.src = FRAMES[sh.id + 'a'] || FRAMES[sh.id + 'b'] || ''; im.alt = sh.id;
    const nn = document.createElement('span'); nn.className = 'n'; nn.textContent = sh.id;
    b.append(im, nn);
    b.addEventListener('click', () => { video.currentTime = sh.start + 0.02; paint(video.currentTime, true); });
    z.append(b);
  });
})();

/* Le plan courant : calque, frise, et l'étiquette de la bascule. */
function majVerdant(sh) {
  const cq = OVERLAYS[sh.id] || '';
  const im = $('img-calque');
  if (im) { im.src = cq; im.alt = cq ? 'Silhouettes du plan ' + sh.id : ''; }
  const b = $('b-calque');
  if (b) {
    b.disabled = !cq;
    if (!cq) { $('visionneuse').dataset.calque = '0'; b.setAttribute('aria-pressed', 'false'); }
  }
  const z0 = $('frise');
  document.querySelectorAll('#frise button').forEach((x) => {
    const on = x.dataset.shot === sh.id;
    x.setAttribute('aria-current', on ? 'true' : 'false');
    // On fait defiler le bandeau seul : scrollIntoView faisait remonter toute la page a chaque plan.
    if (on) { const zr = z0.getBoundingClientRect(), xr = x.getBoundingClientRect(); z0.scrollBy({ left: xr.left + xr.width / 2 - (zr.left + zr.width / 2), behavior: 'smooth' }); }
  });
}

/* La lecture : une icône, pas un mot. */
const ICONE = { lire: 'M8 5l11 7-11 7z', pause: 'M7 5h3.6v14H7zM13.4 5H17v14h-3.6z' };
function marqueLecture() {
  const b = $('b-lire'); if (!b) return;
  const joue = !video.paused && !video.ended;
  $('ico').setAttribute('d', joue ? ICONE.pause : ICONE.lire);
  b.setAttribute('aria-pressed', joue ? 'true' : 'false');
  b.setAttribute('aria-label', joue ? 'Pause' : 'Lecture');
}
if ($('b-lire')) $('b-lire').addEventListener('click', () => { video.paused ? video.play() : video.pause(); });
video.addEventListener('play', marqueLecture);
video.addEventListener('pause', marqueLecture);
video.addEventListener('ended', marqueLecture);
marqueLecture();

/* Le calque des silhouettes. */
if ($('b-calque')) $('b-calque').addEventListener('click', () => {
  const v = $('visionneuse'), on = v.dataset.calque === '1';
  v.dataset.calque = on ? '0' : '1';
  $('b-calque').setAttribute('aria-pressed', on ? 'false' : 'true');
});

/* Le son et le plein écran : la vidéo n'a plus ses propres commandes. */
if ($('b-son')) $('b-son').addEventListener('click', () => {
  video.muted = !video.muted;
  $('b-son').setAttribute('aria-pressed', video.muted ? 'true' : 'false');
  $('b-son').title = video.muted ? 'Rétablir le son' : 'Couper le son';
  $('ico-son').setAttribute('d', video.muted
    ? 'M4 9v6h4l5 4V5L8 9H4zm14.5-.5-1.4-1.4L15 9.2 12.9 7.1l-1.4 1.4L13.6 10.6l-2.1 2.1 1.4 1.4L15 12l2.1 2.1 1.4-1.4-2.1-2.1 2.1-2.1z'
    : 'M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z');
});
if ($('b-plein')) $('b-plein').addEventListener('click', () => {
  const cadre = $('visionneuse').querySelector('.scene');
  if (document.fullscreenElement) document.exitFullscreen();
  else if (cadre.requestFullscreen) cadre.requestFullscreen();
});

/* Glisser une carte sur une autre : « c'est la même personne ». On pose la
   valeur dans le menu déjà en place, donc l'application, le défaire et
   l'enregistrement restent exactement ce qu'ils étaient. */
(function () {
  let pris = null;
  const fiche = (n) => n && n.closest ? n.closest('#cast-grid .fiche') : null;
  const idDe = (fi) => { const sel = fi && fi.querySelector('select.fus'); return sel ? sel.dataset.id : null; };

  document.addEventListener('dragstart', (e) => {
    const im = e.target.closest && e.target.closest('#cast-grid .por');
    if (!im) return;
    const fi = fiche(im); pris = idDe(fi);
    if (!pris) return;
    fi.classList.add('attrape');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', pris);
  });
  document.addEventListener('dragend', () => {
    pris = null;
    document.querySelectorAll('#cast-grid .fiche').forEach((x) => x.classList.remove('attrape', 'cible'));
  });
  document.addEventListener('dragover', (e) => {
    if (!pris) return;
    const fi = fiche(e.target); if (!fi || idDe(fi) === pris) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move'; fi.classList.add('cible');
  });
  document.addEventListener('dragleave', (e) => { const fi = fiche(e.target); if (fi) fi.classList.remove('cible'); });
  document.addEventListener('drop', (e) => {
    const fi = fiche(e.target); if (!fi) return;
    e.preventDefault(); fi.classList.remove('cible');
    const source = (e.dataTransfer && e.dataTransfer.getData('text/plain')) || pris;
    const but = idDe(fi);
    if (!source || !but || source === but) return;
    const sel = document.querySelector('#cast-grid select.fus[data-id="' + source + '"]');
    if (!sel) return;
    sel.value = but;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const etat = $('cast-etat');
    if (etat) etat.textContent = source + ' réunie à ' + but + '.';
  });
})();


/* ═════════════════════════════════════════════ le découpage, en vue ════ */
(function () {
  const T = document.getElementById('dp-table'); if (!T) return;
  const CATS = ['toutes'].concat([...new Set(DATA.shots.map((s) => s.category).filter(Boolean))].sort());
  let cat = 'toutes', role = '', tri = 'ordre';
  // toutes les séquences ouvertes d'office (il fallait les ouvrir une à une) ; « Tout replier » / « Tout déplier »
  const etats = new Set(), ouverts = new Set(DATA.shots.map((sh) => sh.id));

  const presentsDe = (s) => [...new Set((s.subjects || []).concat(Object.keys(s.masks || {})))];
  const ecartesDe = (s) => (DATA.extras || []).filter((g) => g.de < s.end && g.a > s.start);
  const ech = (v) => '"' + String(v).replace(/"/g, '""') + '"';

  function marqueJeu(id, ens) {
    document.querySelectorAll('#' + id + ' button').forEach((b) => b.setAttribute('aria-pressed', String(ens.has(b.dataset.f))));
  }

  /* ── ce que la chaîne n'a pas su faire, en clair et cliquable ── */
  function rendreEtat() {
    const z = document.getElementById('dp-etat'); z.textContent = '';
    const sansSil = DATA.shots.filter((s) => !Object.keys(s.masks || {}).length).length;
    const sansPers = DATA.shots.filter((s) => !presentsDe(s).length).length;
    const off = DATA.shots.reduce((a, s) => a + (s.lines || []).filter((l) => !l.speaker).length, 0);
    const muets = DATA.shots.filter((s) => !(s.lines || []).length).length;
    let ok = 0, tot = 0;
    DATA.shots.forEach((s) => {
      const mk = Object.keys(s.masks || {}); if (!mk.length) return;
      (s.lines || []).forEach((l) => {
        if (!l.speaker || !/vue et entendue/.test(l.how || '')) return;
        tot++; if (mk.indexOf(l.speaker) >= 0) ok++;
      });
    });
    const coh = tot ? Math.round(100 * ok / tot) : 0;
    [['Silhouettes', (DATA.shots.length - sansSil) + '/' + DATA.shots.length, sansSil > 0, 'sans-silhouette'],
     ['Plans sans personne', sansPers, sansPers > 0, 'personne'],
     ['Groupes écartés', (DATA.extras || []).length, (DATA.extras || []).length > 0, null],
     ['Voix off', off, off > 0, 'voix-off'],
     ['Plans muets', muets, false, 'muet'],
     ['Cohérence', coh + '%', false, null]].forEach((it) => {
      const k = it[0], v = it[1], alerte = it[2], filtre = it[3];
      const e = document.createElement(filtre ? 'button' : 'span');
      e.className = 'm' + (alerte ? ' alerte' : '');
      const sp = document.createElement('span'); sp.textContent = k;
      const b = document.createElement('b'); b.textContent = String(v);
      e.append(sp, b);
      if (filtre) {
        e.title = 'Ne garder que ces plans';
        e.setAttribute('aria-pressed', String(etats.has(filtre)));
        e.onclick = () => {
          const seul = etats.size === 1 && etats.has(filtre);
          etats.clear(); if (!seul) etats.add(filtre);
          marqueJeu('dp-etats', etats); rendre();
        };
      }
      z.append(e);
    });
  }

  function majRoles() {
    const sel = document.getElementById('dp-role'), garde = role;
    sel.textContent = '';
    const o = document.createElement('option'); o.value = ''; o.textContent = 'Tous les rôles'; sel.append(o);
    DATA.cast.forEach((c) => { const x = document.createElement('option'); x.value = c.id; x.textContent = c.id + ' · ' + c.name; sel.append(x); });
    sel.value = DATA.cast.some((c) => c.id === garde) ? garde : (role = '');
    sel.onchange = () => { role = sel.value; rendre(); };
  }

  function filtrer() {
    const q = document.getElementById('dp-q').value.trim().toLowerCase();
    let l = DATA.shots.map((s, i) => ({ s: s, i: i }));
    if (cat !== 'toutes') l = l.filter((x) => x.s.category === cat);
    if (role) l = l.filter((x) => presentsDe(x.s).indexOf(role) >= 0 || (x.s.lines || []).some((y) => y.speaker === role));
    if (q) l = l.filter((x) => (x.s.frame || '').toLowerCase().indexOf(q) >= 0 || (x.s.lines || []).some((y) => y.text.toLowerCase().indexOf(q) >= 0));
    etats.forEach((fl) => {
      if (fl === 'sans-silhouette') l = l.filter((x) => !Object.keys(x.s.masks || {}).length);
      if (fl === 'personne') l = l.filter((x) => !presentsDe(x.s).length);
      if (fl === 'muet') l = l.filter((x) => !(x.s.lines || []).length);
      if (fl === 'voix-off') l = l.filter((x) => (x.s.lines || []).some((y) => !y.speaker));
      if (fl === 'court') l = l.filter((x) => x.s.seconds < 1);
    });
    if (tri === 'duree') l.sort((a, b) => b.s.seconds - a.s.seconds);
    return l;
  }

  function detailDe(sh, i) {
    const d = document.createElement('div'); d.className = 'detail';
    const g = document.createElement('div'); g.className = 'bl';
    const vues = document.createElement('div'); vues.className = 'vues';
    [[FRAMES[sh.id + 'a'], 'Image clé'], [FRAMES[sh.id + 'b'], 'Fin de plan'], [OVERLAYS[sh.id], 'Silhouettes']].forEach((p) => {
      if (!p[0]) return;
      const fig = document.createElement('figure');
      const im = document.createElement('img'); im.src = p[0]; im.alt = p[1] + ' ' + sh.id;
      const cap = document.createElement('figcaption'); cap.className = 'lab-s'; cap.textContent = p[1];
      fig.append(im, cap); vues.append(fig);
    });
    g.append(vues);
    const paire = document.createElement('div'); paire.className = 'paire';
    [['Début', tc(sh.start)], ['Fin', tc(sh.end)], ['Durée', sh.seconds.toFixed(2) + ' s'],
     ['Échelle', L.sizes[sh.size] || sh.size || '—'], ['Caméra', L.cams[sh.camera] || sh.camera || '—'],
     ['Catégorie', L.cats[sh.category] || sh.category || '—'], ['Raccord', L.trans[sh.transitionIn] || sh.transitionIn || '—'],
     ['Mouvement', sh.motion == null ? '—' : String(sh.motion)]].forEach((p) => {
      const b = document.createElement('div');
      const lb = document.createElement('span'); lb.className = 'lab-s'; lb.textContent = p[0];
      const v = document.createElement('div'); v.className = 'v'; v.textContent = p[1]; v.title = p[1];
      b.append(lb, v); paire.append(b);
    });
    g.append(paire);

    const dr = document.createElement('div'); dr.className = 'bl';
    const gens = presentsDe(sh), ec = ecartesDe(sh);
    const lab1 = document.createElement('span'); lab1.className = 'lab'; lab1.textContent = "À l'image";
    const tt = document.createElement('div'); tt.className = 'tetes';
    gens.forEach((id) => {
      const e = document.createElement('span'); e.className = 'tete';
      const im = document.createElement('img'); im.src = PORTRAITS[id] || ''; im.alt = '';
      im.style.boxShadow = 'inset 0 0 0 1px ' + castColor(id);
      const bb = document.createElement('b'); bb.textContent = id;
      const sp = document.createElement('span'); sp.textContent = castName(id);
      e.append(im, bb, sp); tt.append(e);
    });
    if (!gens.length) { const v = document.createElement('span'); v.className = 'lab-s'; v.textContent = 'personne identifié'; tt.append(v); }
    dr.append(lab1, tt);

    if ((sh.lines || []).length) {
      const lab2 = document.createElement('span'); lab2.className = 'lab'; lab2.textContent = 'Dialogue';
      dr.append(lab2);
      sh.lines.forEach((l) => {
        const b = document.createElement('div'); b.className = 'rq';
        const h = document.createElement('span'); h.className = 'h'; h.textContent = tc(l.start) + ' → ' + tc(l.end);
        const q = document.createElement('span'); q.className = 'h';
        q.textContent = l.speaker ? castName(l.speaker) : 'voix off';
        if (l.speaker) q.style.color = castColor(l.speaker);
        const x = document.createElement('span'); x.className = 'x'; x.textContent = l.text;
        b.append(h, q, x); dr.append(b);
      });
    }

    /* Ce qui a été écarté est dit, pas effacé — et on dit pourquoi. */
    if (ec.length) {
      const motifs = {};
      ec.forEach((x) => { motifs[x.motif] = (motifs[x.motif] || 0) + 1; });
      const a = document.createElement('div'); a.className = 'avert';
      const b = document.createElement('b'); b.textContent = ec.length + ' groupe(s) écarté(s) traversent ce plan. ';
      a.append(b, document.createTextNode(Object.keys(motifs).map((m) => motifs[m] + ' × « ' + m + ' »').join(' · ')));
      if (!gens.length && (sh.lines || []).some((l) => l.speaker)) {
        a.append(document.createElement('br'),
          document.createTextNode('Incohérence : une réplique est attribuée alors qu’aucun rôle n’est retenu à l’image.'));
      }
      dr.append(a);
    }

    const ouvrir = document.createElement('button'); ouvrir.className = 'outil'; ouvrir.textContent = 'Voir dans le Studio';
    ouvrir.onclick = (e) => {
      e.stopPropagation();
      video.currentTime = sh.start + 0.02; paint(video.currentTime, true);
      const b = document.querySelector('#tabs button[data-tab="studio"]'); if (b) b.click();
    };
    dr.append(ouvrir);
    d.append(g, dr);
    d.onclick = (e) => e.stopPropagation();
    return d;
  }

  function rendre() {
    T.textContent = '';
    const l = filtrer();
    document.getElementById('dp-compte').textContent = l.length + ' / ' + DATA.shots.length + ' plans';
    document.getElementById('dp-total').textContent = l.length + ' plans · '
      + l.reduce((a, x) => a + x.s.seconds, 0).toFixed(1) + ' s cumulées';
    const courant = shotAt(video.currentTime || 0);
    l.forEach((x) => {
      const sh = x.s;
      const bloc = document.createElement('div');
      bloc.className = 'bloc' + (courant && courant.id === sh.id ? ' courant' : '');
      bloc.dataset.shot = sh.id;
      bloc.setAttribute('aria-expanded', String(ouverts.has(sh.id)));
      const lg = document.createElement('div'); lg.className = 'lg';
      const te = document.createElement('span'); te.className = 'teinte';
      te.style.background = sh.teinte || 'var(--panel3)';
      te.title = sh.teinte ? 'teinte moyenne ' + sh.teinte : 'teinte inconnue';
      const no = document.createElement('span'); no.className = 'no'; no.textContent = sh.id;
      const ac = document.createElement('span'); ac.className = 'ac'; ac.textContent = sh.frame || '—'; ac.title = sh.frame || '';
      const pts = document.createElement('span'); pts.className = 'pts';
      const gens = presentsDe(sh);
      gens.slice(0, 5).forEach((id) => { const i2 = document.createElement('i'); i2.style.background = castColor(id); i2.title = castName(id); pts.append(i2); });
      if (gens.length > 5) { const em = document.createElement('em'); em.textContent = '+' + (gens.length - 5); pts.append(em); }
      if (!gens.length) { const em = document.createElement('em'); em.textContent = '—'; pts.append(em); }
      const ca = document.createElement('span'); ca.className = 'lab-s cat'; ca.textContent = L.cats[sh.category] || sh.category || '';
      const ta = document.createElement('span'); ta.className = 'lab-s tai'; ta.textContent = L.sizes[sh.size] || sh.size || '';
      const du = document.createElement('span'); du.className = 'dr'; du.textContent = sh.seconds.toFixed(2);
      const u = document.createElement('span'); u.className = 'u'; u.textContent = 's'; du.append(u);
      lg.append(te, no, ac, pts, ca, ta, du);
      lg.onclick = () => { ouverts.has(sh.id) ? ouverts.delete(sh.id) : ouverts.add(sh.id); rendre(); };
      bloc.append(lg);
      if (ouverts.has(sh.id)) bloc.append(detailDe(sh, x.i));
      T.append(bloc);
    });
    rendreEtat();
  }

  /* ── les commandes ── */
  const jc = document.getElementById('dp-cat');
  CATS.forEach((c) => {
    const b = document.createElement('button');
    b.textContent = c === 'toutes' ? 'toutes' : (L.cats[c] || c);
    b.setAttribute('aria-pressed', String(c === cat));
    b.onclick = () => { cat = c; [...jc.children].forEach((x) => x.setAttribute('aria-pressed', String(x === b))); rendre(); };
    jc.append(b);
  });
  document.querySelectorAll('#dp-etats button').forEach((b) => {
    b.onclick = () => { etats.has(b.dataset.f) ? etats.delete(b.dataset.f) : etats.add(b.dataset.f); marqueJeu('dp-etats', etats); rendre(); };
  });
  document.querySelectorAll('#dp-tri button').forEach((b) => {
    b.onclick = () => { tri = b.dataset.t; document.querySelectorAll('#dp-tri button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); rendre(); };
  });
  document.getElementById('dp-q').oninput = rendre;
  const bRep = document.getElementById('dp-replier');
  bRep.onclick = () => {
    if (ouverts.size) ouverts.clear(); else DATA.shots.forEach((sh) => ouverts.add(sh.id));
    bRep.textContent = ouverts.size ? 'Tout replier' : 'Tout déplier';
    rendre();
  };
  document.getElementById('dp-csv').onclick = () => {
    const ent = ['plan', 'debut', 'fin', 'secondes', 'echelle', 'categorie', 'camera', 'raccord', 'mouvement', 'teinte', 'identifies', 'silhouettes', 'repliques', 'ecartes', 'action'];
    const lignes = filtrer().map((x) => {
      const sh = x.s;
      return [sh.id, sh.start.toFixed(2), sh.end.toFixed(2), sh.seconds.toFixed(2),
        L.sizes[sh.size] || sh.size || '', L.cats[sh.category] || sh.category || '',
        L.cams[sh.camera] || sh.camera || '', L.trans[sh.transitionIn] || sh.transitionIn || '',
        sh.motion == null ? '' : sh.motion, sh.teinte || '',
        presentsDe(sh).map(castName).join(' | '), Object.keys(sh.masks || {}).join(' | '),
        (sh.lines || []).length, ecartesDe(sh).length, sh.frame || ''].map(ech).join(',');
    });
    // Le gabarit de cette page transforme \\uFEFF et \\r\\n en VRAIS caracteres
    // dans le code emis, et un retour chariot brut dans une chaine casse le
    // script. On les construit donc a l'execution.
    const bom = String.fromCharCode(0xFEFF), crlf = String.fromCharCode(13, 10);
    const blob = new Blob([bom + [ent.map(ech).join(',')].concat(lignes).join(crlf)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'depouillement.csv'; a.click();
    URL.revokeObjectURL(a.href);
  };

  // le document tel que la page le montre (corrections comprises), comme « Exporter le JSON » du rapport de la chaîne
  document.getElementById('dp-json').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(DATA, null, 2)], { type: 'application/json' }));
    a.download = (VOIX.slug || 'film') + '-depouillement.json'; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  /* ── ce que montrait le rapport-liste de la chaîne (video-shots render), plus dans une page à part :
     les chiffres, la bande de rythme, les répartitions, les portes qualité. Mêmes calculs que report.js. ── */
  const TOTAL = Number(DATA.meta && DATA.meta.durationSeconds) || DATA.shots.reduce((a, s) => a + s.seconds, 0) || 1;
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  // Aller à un plan depuis le dépouillement : il s'ouvre dans la table, la table vient à lui, la vidéo s'y cale
  // (le Studio le montrera). Pas de scrollIntoView : il fait sauter toute la page ; on défile la fenêtre, sous les barres.
  const defileVers = (n) => {
    if (!n) return;
    const barre = document.querySelector('.fm-bar'), haut = barre ? barre.getBoundingClientRect().bottom : 0;
    window.scrollTo({ top: Math.max(0, n.getBoundingClientRect().top + scrollY - haut - 12), behavior: 'smooth' });
  };
  function allerAuPlan(id) {
    const sh = DATA.shots.find((x) => x.id === id); if (!sh) return;
    video.currentTime = sh.start + 0.02; paint(video.currentTime, true);
    if (!ouverts.has(id)) { ouverts.add(id); rendre(); }
    defileVers(T.querySelector('.bloc[data-shot="' + id + '"]'));
  }
  document.querySelectorAll('#depouillement [data-aller]').forEach((b) => { b.onclick = () => defileVers(document.getElementById(b.dataset.aller)); });
  function rendreChiffres() {
    const secs = DATA.shots.map((s) => s.seconds).sort((a, b) => a - b), n = secs.length;
    const med = n ? (n % 2 ? secs[(n - 1) / 2] : (secs[n / 2 - 1] + secs[n / 2]) / 2) : 0;
    const box = document.getElementById('dp-chiffres'); box.textContent = '';
    [['plans', String(n), ''], ['durée', tc(TOTAL), ''], ['plan moyen', (n ? TOTAL / n : 0).toFixed(2), 's'], ['plan médian', med.toFixed(2), 's'],
     ['min / max', (secs[0] || 0) + ' / ' + (secs[n - 1] || 0), 's'], ['coupes / min', (n / TOTAL * 60).toFixed(1), '']].forEach(([k, v, u]) => {
      const d = el('div'); const b = el('b', null, v); if (u) b.append(el('small', null, u));
      d.append(el('span', 'lab', k), b); box.append(d);
    });
    // la bande : la couleur du plan (la moyenne de ses images clés) quand on la connaît
    const bande = document.getElementById('dp-bande'); bande.textContent = '';
    DATA.shots.forEach((s) => {
      const b = el('button'); b.type = 'button'; b.dataset.shot = s.id;
      b.style.width = (s.seconds / TOTAL * 100) + '%';
      b.style.background = s.teinte || 'var(--panel3)';
      b.title = s.id + ' · ' + tc(s.start) + ' · ' + s.seconds + ' s · ' + (L.sizes[s.size] || s.size || '');
      b.onclick = () => allerAuPlan(s.id);
      bande.append(b);
    });
    const grad = document.getElementById('dp-grad'); grad.textContent = '';
    const pas = [1, 2, 5, 10, 15, 20, 30, 40, 60, 90, 120, 180, 240, 300, 600, 900, 1200, 1800].reverse().find((x) => x <= TOTAL / 5) || 1;
    for (let i = 0; i * pas < TOTAL && i < 5; i++) grad.append(el('span', null, tc(i * pas).slice(0, 5)));
    grad.append(el('span', null, tc(TOTAL)));
  }
  function rendreRepartition() {
    const part = (champ, k) => DATA.shots.filter((s) => s[champ] === k).reduce((a, s) => a + s.seconds, 0) / TOTAL * 100;
    const box = document.getElementById('dp-dist'); box.textContent = '';
    [['size', 'Échelle de plan', 'la distance — à quelle distance le spectateur se tient', L.sizes],
     ['category', 'Catégorie', 'la fonction — ce que le plan vient faire', L.cats],
     ['camera', 'Mouvement', 'le déplacement — par où passe l’émotion', L.cams]]
      .concat(DATA.shots.some((s) => s.rhythm) ? [['rhythm', 'Rôle de rythme', 'pourquoi le spectateur n’a pas encore décroché', L.rhythms]] : [])
      .forEach(([champ, titre, sous, noms]) => {
        const lignes = Object.keys(noms).map((k) => { const it = DATA.shots.filter((s) => s[champ] === k); return { k, nom: noms[k], n: it.length, sec: it.reduce((a, s) => a + s.seconds, 0) }; })
          .filter((x) => x.n).sort((a, b) => b.sec - a.sec);
        const art = el('article', 'dp-rep'); art.append(el('h3', null, titre), el('p', null, sous));
        lignes.forEach((x) => {
          const r = el('div', 'dp-rep-l');
          const t = el('div', 'dp-rep-t'); t.append(el('span', null, x.nom), el('small', null, x.n + ' plan' + (x.n > 1 ? 's' : '') + ' · ' + (x.sec / TOTAL * 100).toFixed(1) + ' %'));
          const barre = el('div', 'dp-rep-b'), i = el('i');
          i.style.width = (x.sec / TOTAL * 100) + '%';
          if (champ === 'rhythm') i.style.background = RHYTHM_COLORS[x.k];
          barre.append(i); r.append(t, barre); art.append(r);
        });
        box.append(art);
      });
    // la phrase de synthèse, calculée elle aussi
    const haut = (champ) => [...new Set(DATA.shots.map((s) => s[champ]))].sort((a, b) => part(champ, b) - part(champ, a))[0];
    const long = DATA.shots.reduce((a, s) => (!a || s.seconds > a.seconds ? s : a), null), court = DATA.shots.reduce((a, s) => (!a || s.seconds < a.seconds ? s : a), null);
    const hs = haut('size'), hc = haut('category'), note = document.getElementById('dp-note'); note.textContent = '';
    if (!long) return;
    note.append('Surtout du ', el('b', null, L.sizes[hs] || hs || '—'), ', ', el('b', null, part('size', hs).toFixed(1) + ' %'), ' de la durée ; ',
      el('b', null, L.cats[hc] || hc || '—'), ' pèse ', el('b', null, part('category', hc).toFixed(1) + ' %'), '. Plan le plus long ',
      el('b', null, long.id + ' · ' + long.seconds + ' s'), ', le plus court ', el('b', null, court.id + ' · ' + court.seconds + ' s'), '.');
  }
  function rendrePortes() {
    const box = document.getElementById('dp-portes'); box.textContent = '';
    if (!PORTES) { box.append(el('p', 'aide', 'portes non calculées au rendu')); return; }
    const echec = PORTES.gates.filter((g) => !g.ok), saute = PORTES.gates.filter((g) => g.skipped), N = PORTES.gates.length;
    document.getElementById('dp-portes-n').textContent = [(N - echec.length - saute.length) + ' passées', echec.length ? echec.length + ' en échec' : '',
      saute.length ? saute.length + ' sautée' + (saute.length > 1 ? 's' : '') : '', PORTES.hints.length ? PORTES.hints.length + ' indice' + (PORTES.hints.length > 1 ? 's' : '') : ''].filter(Boolean).join(' · ');
    if (echec.length) document.getElementById('dp-aller-portes').textContent = 'Portes qualité · ' + echec.length + ' en échec';
    const tete = el('div', 'dp-verdict' + (echec.length ? ' aregarder' : ''));
    tete.append(el('b', null, echec.length ? echec.length + ' porte' + (echec.length > 1 ? 's' : '') + ' en échec' : 'les ' + N + ' portes sont passées'),
      el('span', null, 'ligne de temps, images clés et annotations vérifiées par le script, de façon déterministe, au rendu de la page'));
    box.append(tete);
    const ul = el('ul', 'dp-gates');
    PORTES.gates.forEach((g) => {
      const li = el('li', g.skipped ? 'saute' : g.ok ? 'ok' : 'echec');
      const t = el('div', 'g-t'); t.append(el('b', null, g.label), el('span', 'g-e', g.skipped ? 'sautée' : g.ok ? 'passée' : 'échec'));
      li.append(t);
      if (g.skipped) li.append(el('div', 'g-n', g.skipped));
      if (g.issues && g.issues.length) { const u = el('ul'); g.issues.forEach((x) => u.append(el('li', null, x))); li.append(u); }
      ul.append(li);
    });
    box.append(ul);
    if (PORTES.hints.length) {
      const h = el('div', 'dp-indices'); h.append(el('span', 'lab', PORTES.hints.length === 1 ? '1 indice à regarder' : PORTES.hints.length + ' indices à regarder'));
      PORTES.hints.forEach((x) => {
        // (le deux-points pleine chasse des indices en chinois, écrit en échappement : aucun idéogramme dans la page)
        const m = /^(S\\d+)[\\uFF1A:]\\s*(.*)$/.exec(x), p = el('p');
        if (m) { const b = el('button', 'outil', m[1] + ' ↗'); b.type = 'button'; b.onclick = () => allerAuPlan(m[1]); p.append(b, ' ' + m[2]); } else p.textContent = x;
        h.append(p);
      });
      box.append(h);
    }
  }
  // le plan courant (la vidéo, le Studio) marqué dans la table et sur la bande, sans rien redessiner
  window.xvPlanCourant = (s) => {
    T.querySelectorAll('.bloc').forEach((b) => b.classList.toggle('courant', !!s && b.dataset.shot === s.id));
    document.querySelectorAll('#dp-bande button').forEach((b) => b.classList.toggle('on', !!s && b.dataset.shot === s.id));
  };

  /* Une correction change les noms et les fusions : la vue se refait. */
  window.xvRendreDecoupage = function () { majRoles(); rendre(); };
  majRoles(); rendre();
  rendreChiffres(); rendreRepartition(); rendrePortes();
  window.xvPlanCourant(shotAt(video.currentTime || 0));
})();

/* La vue dans l'adresse : ?vue=casting|depouillement ouvre sur elle, et chaque onglet l'y écrit (le #S05 du plan
   reste). History.prototype : la page retient replaceState tant qu'elle saute au plan demandé. */
(function () {
  const vues = ['studio', 'casting', 'depouillement'];
  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => {
    const u = new URL(location.href);
    if (b.dataset.tab === 'studio') u.searchParams.delete('vue'); else u.searchParams.set('vue', b.dataset.tab);
    History.prototype.replaceState.call(history, history.state, '', u);
  }));
  const v = new URLSearchParams(location.search).get('vue');
  if (vues.indexOf(v) > 0) { const b = document.querySelector('#tabs button[data-tab="' + v + '"]'); if (b) b.click(); }
})();

</script>
</body>
</html>`;

const out = flag('-o', 'studio.html');
// (--fragment, pour l'hébergeur d'artefacts de MOVIE_ANALYSE, n'a plus de sens : la page est celle du portail)
writeFileSync(out, html);
const pt = PORTES ? `, portes ${PORTES.gates.filter((g) => g.ok && !g.skipped).length} passées / ${PORTES.gates.filter((g) => !g.ok).length} en échec / ${PORTES.gates.filter((g) => g.skipped).length} sautées` : '';
process.stderr.write(`studio (portail) → ${out} (${Math.round(Buffer.byteLength(html) / 1024)} Ko : ${Object.keys(FRAMES).length} images clés, ${Object.keys(OVERLAYS).length} calques, ${Object.keys(PORTRAITS).length} portraits${pt})\n`);
