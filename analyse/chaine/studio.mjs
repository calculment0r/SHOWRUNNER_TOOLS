#!/usr/bin/env node
/**
 * STUDIO — une seule page MOVIE ANALYSIS qui rassemble tout :
 *
 *   ┌ barre ──────────────────────────────────────────────────────────────┐
 *   │ ← Accueil · MOVIE ANALYSIS · titre   [ Studio | Casting | Découpage ]
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
 *   L'onglet Dépouillement = le rapport-liste existant, dans un cadre.
 *
 *   node studio.mjs shots.json --video wall.mp4 --frames frames --overlays overlays \
 *        --portraits portraits --report rapport.html --css report.css -o studio.html
 *
 * Tout est embarqué (images, polices) sauf la vidéo et le rapport-liste, servis
 * à côté du fichier. #S03 dans l'adresse ouvre le studio sur ce plan.
 * --video-url https://…/video : la vidéo et les pistes de son prises sur R2
 * (<url>/<slug>/<fichier>), celles d'à côté en repli.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as CASTING from './casting-parts.mjs';

const [file, ...rest] = process.argv.slice(2);
const flag = (n, d = null) => { const i = rest.indexOf(n); return i < 0 ? d : rest[i + 1]; };
if (!file) { console.error('usage: studio.mjs shots.json --video v.mp4 [--video-url https://…/video] [--frames dir] [--overlays dir] [--portraits dir] [--report rapport.html] [--css report.css] -o studio.html'); process.exit(1); }

const doc = JSON.parse(readFileSync(file, 'utf8'));
const video = flag('--video', doc.source ?? 'video.mp4');
const dirs = { frames: flag('--frames', 'frames'), overlays: flag('--overlays', 'overlays'), portraits: flag('--portraits', 'portraits') };
const reportHref = flag('--report', 'rapport.html');
// Cle de memorisation des noms corriges : un dossier d'analyse = un casting.
const slug = flag('--slug', basename(video).replace(/\.[^.]+$/, ''));
const cssFile = flag('--css', null);
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
const VOIX_CSS = readFileSync(join(ICI, 'voix.css'), 'utf8').replace(/\r\n/g, '\n');

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

// les polices du kit, reprises telles quelles dans report.css (base64).
// On normalise les fins de ligne : sur un checkout Windows, report.css arrive en
// CRLF et la page rendue differait de celle rendue ailleurs, pour rien.
let fonts = '';
if (cssFile && existsSync(cssFile)) {
  const css = readFileSync(cssFile, 'utf8').replace(/\r\n/g, '\n');
  fonts = (css.match(/@font-face\{[\s\S]*?\}/g) ?? []).join('\n');
}

/* ------------------------------------------------------------- libellés -- */
const L = {
  sizes: { none: 'sans échelle', 'extreme-wide': 'plan général', wide: "plan d'ensemble", 'medium-wide': 'plan moyen', medium: 'plan américain', 'medium-close': 'plan rapproché', close: 'gros plan', 'extreme-close': 'très gros plan' },
  cats: { establishing: "plan d'exposition", subject: 'sujet', dialogue: 'dialogue', reaction: 'réaction', insert: 'insert', pov: 'vue subjective', empty: "plan d'ambiance", product: 'plan produit', 'text-card': 'carton', transition: 'plan de transition', archive: "images d'archive" },
  cams: { static: 'fixe', 'push-in': 'travelling avant', 'pull-out': 'travelling arrière', 'zoom-in': 'zoom avant', 'zoom-out': 'zoom arrière', 'pan-left': 'panoramique gauche', 'pan-right': 'panoramique droite', 'tilt-up': 'panoramique vertical haut', 'tilt-down': 'panoramique vertical bas', 'truck-left': 'travelling latéral gauche', 'truck-right': 'travelling latéral droite', 'pedestal-up': 'montée verticale', 'pedestal-down': 'descente verticale', tracking: "travelling d'accompagnement", arc: 'travelling circulaire', 'whip-pan': 'filé', handheld: "caméra à l'épaule", shake: 'secousses', 'rack-focus': 'changement de point', 'micro-push': 'micro-travelling avant', roll: 'rotation', drone: 'drone' },
  trans: { cut: 'coupe franche', dissolve: 'fondu enchaîné', 'fade-in': 'ouverture en fondu', 'fade-out': 'fermeture en fondu', whip: 'coupe filée', 'match-cut': 'raccord graphique', wipe: 'volet', morph: 'transition truquée' },
  rhythms: { hook: 'accroche', setup: 'mise en place', build: 'montée', beat: 'accent', turn: 'bascule', payoff: 'récompense', breath: 'respiration', close: 'chute' },
};
const SIZE_COLORS = { none: '#EAE6D9', 'extreme-wide': '#DDD8C8', wide: '#C8C0A8', 'medium-wide': '#B0A78C', medium: '#938970', 'medium-close': '#756C57', close: '#55503F', 'extreme-close': '#35322A' };
const RHYTHM_COLORS = { hook: '#A67A16', setup: '#8C846A', build: '#2E6E9E', beat: '#4E7A3B', turn: '#A85570', payoff: '#B23138', breath: '#2F7E74', close: '#7D5A76' };
const CAST_COLORS = ['#e0674a', '#b9cfd8', '#3f9a6a', '#d9a486', '#f0b49b', '#2f6b4a', '#e59578', '#8fb3c0',
  '#d47a5c', '#4f8f6a', '#c99b7a', '#a3502f', '#6fa88c', '#e8c4ae', '#7a3a22', '#24543b'];

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
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#0a0d0b">
<title>${esc(DATA.title)} · Movie Analysis</title>
<style>
${fonts}
/* ── Verdant : une seule palette, sombre par construction (kit Showrunner) ── */
:root{--surface:#0a0d0b;--surface-2:#101413;--surface-3:#151a18;--surface-4:#1b211e;--ink:#e6eae7;--ink-2:#9ca8a2;--ink-3:#7c8884;--hairline:rgba(47,107,74,.42);--hairline-strong:rgba(47,107,74,.8);--red-accent:#e0674a;--red-hairline:rgba(224,103,74,.7);--red-fill:rgba(224,103,74,.13);--signal:#d9a486;--signal-fill:rgba(217,164,134,.15);--ok:#3f9a6a;--stage:#070908;--stage-2:#0a0d0b;--stage-ink:#e6eae7;--stage-ink-2:#9ca8a2;--ui:'Chakra Petch','Helvetica Neue','Segoe UI',Arial,sans-serif;--mono:'Azeret Mono',ui-monospace,Menlo,monospace;--disp:'Venus Rising','Chakra Petch',sans-serif}
*{box-sizing:border-box}html{scroll-behavior:auto}

body{margin:0;background:var(--surface);color:var(--ink);font:400 13px/1.55 var(--ui)}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
.lab{font:600 9px/1 var(--ui);letter-spacing:1.6px;text-transform:uppercase;color:var(--ink-3)}
[hidden]{display:none!important}

/* ── la barre ── */
.bar{position:sticky;top:0;z-index:50;display:flex;align-items:center;gap:16px;padding:9px 20px;background:var(--surface-2);border-bottom:1px solid var(--hairline)}
.bar .mark{font:700 12px/1 var(--ui);letter-spacing:2.4px;text-transform:uppercase}.bar .mark b{color:var(--red-accent)}
.bar .title{font:600 13px/1 var(--ui);color:var(--ink-2)}.bar .title small{font:400 10px var(--mono);color:var(--ink-3);margin-left:10px}
.bar .sep{flex:1}
.seg{display:inline-flex;border:1px solid var(--hairline-strong)}
.seg button{height:24px;padding:0 12px;font:600 9px/1 var(--ui);letter-spacing:1.2px;text-transform:uppercase;color:var(--ink-3);border-right:1px solid var(--hairline)}
.seg button:last-child{border-right:0}.seg button[aria-pressed="true"]{background:var(--red-fill);color:var(--ink)}.seg button:hover:not([aria-pressed="true"]){background:var(--surface-3);color:var(--ink-2)}

/* ── scène + scénario ── */
.wrap{padding:14px 20px 40px}
/* Deux réglages indépendants (28/09) : la hauteur de la scène (poignée de la timeline) et la largeur du script
   (poignée du script). La vidéo remplit au mieux son cadre ; la timeline est là où on l'a posée. Avant, la poignée
   du script recalculait la hauteur de la vidéo et défaisait celle de la timeline. */
.stage-row{display:grid;grid-template-columns:minmax(0,1fr) 12px var(--l-script,400px);gap:0;align-items:stretch;height:var(--h-scene,62vh)}
.stage-row>.player{min-height:0;overflow:hidden}
.visionneuse{display:flex!important;flex-direction:column;flex:1;min-height:0}
.visionneuse .scene{flex:1;min-height:0}
.visionneuse .hud,.visionneuse .st{flex:none}
.player{background:var(--stage-2);border:1px solid var(--hairline-strong);display:flex;flex-direction:column;min-width:0}
.player video{width:100%;display:block;background:#000}
.hud{display:flex;align-items:center;gap:14px;padding:8px 12px;color:var(--stage-ink);font:600 9px/1 var(--ui);letter-spacing:1.4px;text-transform:uppercase;border-top:1px solid #2D2D2B}
.hud .mono{font-size:12px;letter-spacing:0;text-transform:none;color:var(--stage-ink)}.hud .dim{color:var(--stage-ink-2)}.hud .sep{flex:1}
.hud button,.hud label{color:var(--stage-ink-2);border:1px solid #2D2D2B;padding:4px 8px;font:600 9px/1 var(--ui);letter-spacing:1.1px;text-transform:uppercase;cursor:pointer}.hud button:hover,.hud label:hover{color:var(--stage-ink);background:rgba(255,255,255,.06)}
/* L'action du plan, contre la video : on doit pouvoir la lire EN REGARDANT, pas
   trois ecrans plus bas. Elle occupe la place que la colonne laissait vide. */
.actionnow{flex:1;min-height:92px;overflow:auto;padding:16px 20px;border-top:1px solid #2D2D2B;background:var(--stage-2);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.actionnow .lab{display:block;margin-bottom:6px;font:600 9px/1 var(--ui);letter-spacing:1.4px;text-transform:uppercase;color:var(--stage-ink-2)}
.actionnow .txt{color:var(--stage-ink);font:400 19px/1.45 var(--ui);max-width:62ch;text-wrap:balance}
.actionnow .oi{margin-top:9px;color:var(--signal);font:600 10px/1.5 var(--ui);letter-spacing:1.3px;text-transform:uppercase}
.actionnow .vide{color:var(--stage-ink-2);font-size:12px}
.nofile{padding:10px 14px;background:var(--signal-fill);border-top:1px solid var(--signal);color:var(--ink-2);font-size:11.5px}
.nofile .link{color:var(--red-accent);text-decoration:underline;cursor:pointer}
.script{border:1px solid var(--hairline-strong);background:var(--surface-2);position:relative;display:flex;flex-direction:column;min-height:0}
.script::before,.script::after{content:'';position:absolute;width:7px;height:7px;border:1px solid var(--red-hairline)}.script::before{top:-1px;left:-1px;border-right:0;border-bottom:0}.script::after{bottom:-1px;right:-1px;border-left:0;border-top:0}
.script-head{display:flex;align-items:center;gap:10px;padding:9px 14px;border-bottom:1px solid var(--hairline)}
.script-body{overflow:auto;padding:10px 22px 40vh;font-family:var(--mono);font-size:12.5px;line-height:1.6;max-height:56vh}
.sc-shot{padding:10px 0 6px;border-top:1px solid var(--hairline)}.sc-shot:first-child{border-top:0}
.sc-carton{font:600 10px/1.55 var(--ui);letter-spacing:1.1px;text-transform:uppercase;color:var(--signal);border-left:2px solid var(--signal);padding:2px 0 2px 9px;margin:7px 0}
.sc-trans{font:600 9.5px/1.6 var(--ui);letter-spacing:1.7px;text-transform:uppercase;color:var(--ink-3);text-align:right;margin:16px 0 8px;padding-right:2px}
.sc-slug{font:600 9px/1.6 var(--ui);letter-spacing:1.3px;text-transform:uppercase;color:var(--ink-3);display:flex;gap:10px;flex-wrap:wrap;align-items:baseline}.sc-slug b{color:var(--ink)}.sc-slug i{font-style:normal;color:var(--ink-2)}
.sc-action{margin:6px 0 4px;color:var(--ink-2)}
.sc-text{margin:4px 0;color:var(--signal);font-size:11px}
.sc-line{margin:8px 0 2px;padding:4px 10px;border-left:2px solid transparent}
.sc-who{font:600 11px/1.4 var(--ui);letter-spacing:1.2px;text-transform:uppercase;text-align:center;color:var(--ink-2)}.sc-who small{font-weight:400;letter-spacing:0;text-transform:none;color:var(--ink-3)}
.sc-say{text-align:center;padding:0 12%}
.sc-shot.now{background:var(--surface-3)}
.sc-line.now{border-left-color:var(--red-accent);background:var(--red-fill)}.sc-line.now .sc-who{color:var(--red-accent)}

/* ── timeline ── */
.tl{margin-top:14px;border:1px solid var(--hairline-strong);background:var(--surface-2);position:relative}
.tl::before,.tl::after{content:'';position:absolute;width:7px;height:7px;border:1px solid var(--red-hairline)}.tl::before{top:-1px;left:-1px;border-right:0;border-bottom:0}.tl::after{bottom:-1px;right:-1px;border-left:0;border-top:0}
.tl-head{display:flex;align-items:center;gap:12px;padding:8px 14px;border-bottom:1px solid var(--hairline)}
.tl-head .hint{font-size:10px;color:var(--ink-3)}
.ruler{position:relative;height:18px;border-bottom:1px solid var(--hairline);margin-left:96px;overflow:hidden}
.ruler .tk{position:absolute;top:0;height:100%;border-left:1px solid var(--hairline-strong);padding-left:4px;font:9px/18px var(--mono);color:var(--ink-3);white-space:nowrap}.ruler .tk.minor{border-left-color:var(--hairline);color:transparent}
.lane{display:grid;grid-template-columns:96px 1fr;border-bottom:1px solid var(--hairline)}.lane:last-child{border-bottom:0}
.lane-name{font:600 9px/1 var(--ui);letter-spacing:1.4px;text-transform:uppercase;color:var(--ink-3);padding:0 10px;display:flex;align-items:center;border-right:1px solid var(--hairline);background:var(--surface)}
.lane-name.on{color:var(--ink)}.lane-name i{width:6px;height:6px;background:var(--hairline-strong);margin-right:7px}.lane-name.on i{background:var(--red-accent)}
.track{position:relative;height:30px;overflow:hidden}.track.tall{height:auto;min-height:30px}
.blk{position:absolute;top:4px;height:22px;border:1px solid var(--hairline-strong);background:var(--surface-3);font:600 9.5px/20px var(--ui);letter-spacing:.5px;padding:0 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ink);cursor:pointer;text-transform:uppercase}
.blk.dl{text-transform:none;letter-spacing:0;font-family:var(--mono);font-weight:400}
/* Presence = un trait. La replique s'ecrit SUR le rail de qui la dit : deux
   personnes qui parlent en meme temps occupent deux rails, la ou un rail
   « dialogue » unique les aurait empilees au meme endroit. */
.blk.trait{top:13px;height:4px;padding:0;border:0;font-size:0;opacity:.55}
.blk.trait.on{opacity:1;outline:0;height:6px;top:12px}
.blk.dit{top:3px;height:24px;line-height:22px;font:400 10.5px/22px var(--mono);letter-spacing:0;text-transform:none;border-color:transparent}
.blk.dit.on{outline:2px solid var(--ink);outline-offset:-1px}
.blk.on{outline:2px solid var(--red-accent);outline-offset:-1px;z-index:2}
.blk.p{top:auto}

/* ── le plan ── */
.shot{margin-top:14px;display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:14px}
.frame-card{border:1px solid var(--hairline-strong);background:var(--surface-2);padding:12px}
.frames{display:grid;grid-template-columns:1fr 1fr;gap:6px}.frames img{width:100%;display:block;background:#000;aspect-ratio:16/9;object-fit:contain}
.frames figcaption{font:600 8.5px/1.8 var(--ui);letter-spacing:1.2px;text-transform:uppercase;color:var(--ink-3)}
.overlay{margin-top:8px}.overlay img{width:100%;display:block;background:#000}
.overlay .none{padding:18px;border:1px dashed var(--hairline-strong);color:var(--ink-3);font-size:11px;text-align:center}
.info{border:1px solid var(--hairline-strong);background:var(--surface-2);padding:14px 16px;display:flex;flex-direction:column;gap:10px;min-width:0}
.info h2{margin:0;font:700 22px/1.1 var(--ui);letter-spacing:-.4px;display:flex;align-items:baseline;gap:12px}.info h2 .mono{font-size:12px;color:var(--ink-3);letter-spacing:0}
.info .desc{font-size:14px;line-height:1.6;color:var(--ink);margin:0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:1px;background:var(--hairline);border:1px solid var(--hairline)}
.cell{background:var(--surface-2);padding:8px 10px;min-width:0}.cell .lab{display:block;margin-bottom:4px}.cell b{font-weight:600;font-size:12.5px;display:block;overflow:hidden;text-overflow:ellipsis}.cell .mono{font-size:13px}
.cell.red b{color:var(--red-accent)}
.people{display:flex;gap:8px;flex-wrap:wrap}
.person{display:flex;align-items:center;gap:8px;border:1px solid var(--hairline);padding:4px 8px 4px 4px;font-size:11px}.person img{width:34px;height:34px;object-fit:cover;display:block;background:var(--surface-3)}.person i{width:8px;height:8px;flex:none}
.person .pct{font-family:var(--mono);color:var(--red-accent);margin-left:4px}
.lines{border-top:1px solid var(--hairline);padding-top:8px;font-family:var(--mono);font-size:12px}
.lines div{padding:2px 0}.lines b{font:600 9px/1 var(--ui);letter-spacing:1.2px;text-transform:uppercase;color:var(--ink-3);margin-right:8px}.lines div.now b{color:var(--red-accent)}
.rh{display:inline-flex;align-items:center;gap:6px}.rh i{width:8px;height:8px}
.note{font-size:11px;color:var(--ink-3)}

/* ── dépouillement (le rapport-liste existant, dans un cadre) ── */
#depouillement iframe{width:100%;height:calc(100vh - 60px);border:0;display:block;background:var(--surface)}
${CASTING.CASTING_CSS}

@media(max-width:1100px){.stage-row{grid-template-columns:1fr;height:auto}.sep-v{display:none}.script-body{max-height:40vh}.shot{grid-template-columns:1fr}
  .visionneuse .scene{flex:none}.visionneuse .scene video{height:auto;max-height:50vh}}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}

/* ── Verdant : le display sur ce qui se lit d'un coup d'œil. Pose en dernier,
      une declaration font raccourcie plus haut remettrait la famille a zero. ── */
.bar .title,.bar .mark,h1,h2,h3,.cast-head h2{font-family:var(--disp);font-weight:400;letter-spacing:.07em}
#hud-shot,#hud-time,.tl .tk,.big,.kpi b,.chiffre{font-family:var(--disp);letter-spacing:.02em}
.lab,.dim,.hint{font-family:var(--mono);letter-spacing:.16em;text-transform:uppercase}
/* ── Verdant : en-tête à deux rangs, menu d'onglets centré ── */
.bar{display:block;padding:0;background:rgba(10,13,11,.95);backdrop-filter:blur(12px)}
.bar .haut{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:8px 20px 6px;box-shadow:inset 0 -1px 0 rgba(47,107,74,.4)}
.bar .mark{font-size:12px;letter-spacing:.24em;color:var(--ink);text-decoration:none;white-space:nowrap}
.bar .retour{display:inline-flex;align-items:center;gap:7px;border-radius:6px;padding:7px 12px;box-shadow:inset 0 0 0 1px var(--hairline-strong);
  font:600 11px/1 var(--ui);letter-spacing:.06em;color:var(--ink-2);text-decoration:none;white-space:nowrap}
.bar .retour:hover{color:var(--ink);box-shadow:inset 0 0 0 1px #3f9a6a;background:rgba(47,107,74,.14)}
.bar .retour svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.5}
.bar .title{font-size:15px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink)}
.bar .title small{display:inline-block;margin-left:10px;font:400 9px/1.3 var(--mono);
  letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.menu{position:relative;display:flex;justify-content:center;margin-left:auto}
.menu .pan{position:relative;display:flex}
.menu button{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;
  padding:6px 18px 8px;background:none;border:0;cursor:pointer}
.menu .ix{font-family:var(--mono);font-size:8px;letter-spacing:.24em;color:var(--ink-3);transition:color .18s}
.menu .nm{font-family:var(--disp);font-size:14px;letter-spacing:.17em;text-transform:uppercase;
  color:var(--ink-3);transition:color .18s;white-space:nowrap}
.menu button:hover .nm{color:var(--ink-2)}
.menu button[aria-pressed="true"] .nm{color:var(--ink)}
.menu button[aria-pressed="true"] .ix{color:var(--red-accent)}
.menu .curseur{position:absolute;bottom:-1px;left:0;width:0;height:2px;background:var(--red-accent);
  transition:transform .26s cubic-bezier(.4,0,.2,1),width .26s cubic-bezier(.4,0,.2,1)}

/* ── la frise des plans, au-dessus de l'image ── */
.frise{display:flex;gap:4px;overflow-x:auto;padding-bottom:3px;margin-bottom:10px}
/* les vignettes suivent la taille de la vidéo (poignée de la timeline) */
.frise button{flex:0 0 auto;position:relative;overflow:hidden;width:clamp(52px,calc(var(--h-scene,62vh) * .14),108px);padding:0;border:0;
  background:none;cursor:pointer;opacity:.62;box-shadow:inset 0 0 0 1px transparent;transition:box-shadow .15s,opacity .15s}
.frise button:hover{opacity:1}
.frise button img{display:block;width:100%;height:auto;aspect-ratio:108/45;object-fit:cover}
.frise button[aria-current="true"]{opacity:1;box-shadow:0 0 0 2px var(--red-accent)}
.frise button .n{position:absolute;left:4px;bottom:2px;font-family:var(--disp);font-size:10px;
  color:#e6eae7;text-shadow:0 1px 3px #000}

/* ── la visionneuse : coins carrés, un rayon rognerait le cadre ── */
.visionneuse{display:block}
.visionneuse .scene{position:relative;background:#000;overflow:hidden;line-height:0}
.visionneuse .scene video{display:block;width:100%;height:100%;object-fit:contain;border-radius:0}
.visionneuse .scene .calque{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;
  opacity:0;transition:opacity .22s;pointer-events:none}
.visionneuse[data-calque="1"] .scene .calque{opacity:1}

/* ── la barre de lecture : repères à gauche, lecture au centre, calque à droite ── */
.player .hud{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center;
  padding:8px 12px;background:var(--surface-3);border:0}
.player .hud > *{min-width:0}
.hud .g{display:flex;align-items:center;gap:10px}
.hud .g.droite{justify-content:flex-end}
.hud .gros{font-family:var(--disp);font-size:19px;line-height:1;color:var(--ink);width:62px;white-space:nowrap}
.hud .tc{font-family:var(--mono);font-size:9px;letter-spacing:.1em;color:var(--ink-3);white-space:nowrap;width:150px}
.lecture{width:42px;height:42px;border-radius:999px;display:grid;place-items:center;border:0;cursor:pointer;
  background:none;box-shadow:inset 0 0 0 1.5px var(--red-accent);color:var(--red-accent);
  transition:box-shadow .15s,color .15s,background .15s}
.lecture:hover{background:var(--red-fill);color:#f0b49b;box-shadow:inset 0 0 0 1.5px #e59578}
.lecture svg{width:15px;height:15px;fill:currentColor;display:block}
.lecture[aria-pressed="true"]{background:var(--red-accent);color:#170c08;box-shadow:none}
.outil{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:0;cursor:pointer;
  border-radius:10px;padding:8px 14px;background:none;font:600 11px/1 var(--ui);letter-spacing:.08em;
  text-transform:uppercase;color:var(--ink-2);white-space:nowrap;box-shadow:inset 0 0 0 1px var(--hairline);
  transition:color .15s,box-shadow .15s,background .15s}
.outil:hover{color:var(--ink);box-shadow:inset 0 0 0 1px rgba(63,154,106,.95)}
.outil[aria-pressed="true"]{background:#b9cfd8;color:#0a0d0b;box-shadow:none}
.outil:disabled{opacity:.35;cursor:default}
.outil.ico{padding:8px 10px}
.outil.ico svg{width:14px;height:14px;fill:currentColor;display:block}

/* ── le sous-titre : sous l'image, jamais par-dessus ── */
.st{display:flex;align-items:center;justify-content:center;min-height:54px;padding:11px 22px;
  background:var(--surface-2)}
.st p{margin:0;font-size:15.5px;line-height:1.4;text-align:center;color:var(--ink);opacity:0;transition:opacity .14s}
.st p.on{opacity:1}

/* ── l'action : plus grande, centrée ── */
/* Hauteur FIGEE : l'action est plus ou moins longue selon le plan, et le
   panneau faisait monter et descendre la timeline a chaque raccord. On reserve
   la place de trois lignes une fois pour toutes ; au-dela le texte est coupe et
   reste lisible en entier au survol. */
.actionnow{flex:none;height:132px;min-height:0;padding:14px 22px;text-align:center;color:var(--ink);
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;overflow:hidden}
.actionnow .txt{font:400 19px/1.45 var(--ui);max-width:62ch;text-wrap:balance;
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.actionnow .oi{margin-top:0}
/* La colonne du script : sa hauteur est celle de la colonne video (le contenu est pose par-dessus, en absolu, et ne
   pese pas sur la ligne) ; avant, le script s'arretait a 56 vh et laissait une bande vide en bas. */
.script-in{position:absolute;inset:0;display:flex;flex-direction:column;min-height:0}
.script-in .script-body{flex:1;min-height:0;max-height:none}
.player .actionnow{flex:none;height:108px;padding:10px 22px}
.player .actionnow .txt{font-size:17px}
/* les poignées */
.sep-v{position:relative;cursor:col-resize;touch-action:none}
.sep-v::after{content:'';position:absolute;top:0;bottom:0;left:5px;width:2px;border-radius:1px;background:rgba(47,107,74,.22);transition:background .15s}
.sep-h{position:relative;height:14px;cursor:row-resize;touch-action:none}
.sep-h::after{content:'';position:absolute;left:0;right:0;top:6px;height:2px;border-radius:1px;background:rgba(47,107,74,.22);transition:background .15s}
.sep-v:hover::after,.sep-h:hover::after,.sep-v.actif::after,.sep-h.actif::after{background:var(--ok)}
body.redim{user-select:none}
body.redim.col{cursor:col-resize}body.redim.row{cursor:row-resize}
@media(max-width:1100px){.script-in{position:static}.script-in .script-body{flex:none;max-height:40vh}}
/* Les barres de defilement aux couleurs du theme, partout (vignettes au-dessus de la video, script, casting…) :
   pas le gris du systeme */
*{scrollbar-width:thin;scrollbar-color:rgba(47,107,74,.8) rgba(47,107,74,.10)}
::-webkit-scrollbar{width:8px;height:8px}
::-webkit-scrollbar-track{background:rgba(47,107,74,.10);border-radius:4px}
::-webkit-scrollbar-thumb{background:rgba(47,107,74,.8);border-radius:4px}
::-webkit-scrollbar-thumb:hover{background:var(--ok)}

/* ── la timeline Verdant ── */
.tl{background:var(--surface-2);padding:16px;display:flex;flex-direction:column;gap:10px}
.tl-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.tl .zone{overflow-x:auto;overflow-y:hidden}
.tl .enveloppe{position:relative;width:calc(100% * var(--zoom,1));min-width:760px}
.tl .grille{width:100%;display:grid;grid-template-columns:154px minmax(0,1fr);gap:0 12px;align-items:center}
.tl .nom{position:sticky;left:0;z-index:4;background:var(--surface-2);
  font-family:var(--mono);font-size:8.5px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:4px 8px 4px 0}
.tl .rail{position:relative;height:19px;border-radius:5px;background:var(--surface-4)}
.tl .seg{position:absolute;top:0;bottom:0;border-radius:4px;opacity:.3}
.tl .dit{position:absolute;top:2px;bottom:2px;border-radius:3px;cursor:pointer;
  display:flex;align-items:center;padding:0 5px;overflow:hidden}
.tl .dit i{font:500 9px/1 var(--ui);font-style:normal;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tl .regle{position:relative;height:18px;cursor:ew-resize}
.tl .tick{position:absolute;top:0;bottom:0;width:1px;background:rgba(185,207,216,.16);cursor:pointer}
.tl .tick b{position:absolute;top:2px;left:4px;font-family:var(--disp);font-size:8px;font-weight:400;
  color:var(--ink-3);white-space:nowrap;opacity:0;transition:opacity .15s}
.tl .grille[data-dense="1"] .tick b{opacity:1}
/* La cue traverse toute la hauteur : 166px = la colonne des noms (154) + la gouttière (12). */
.tl .cue{position:absolute;top:0;bottom:0;width:2px;background:var(--red-accent);pointer-events:none;z-index:5;
  left:calc(166px + (100% - 166px) * var(--t,0))}
.tl .cue b{position:absolute;top:-3px;left:-10px;width:22px;height:16px;pointer-events:auto;cursor:ew-resize;display:block}
.tl .cue b::after{content:'';position:absolute;top:3px;left:4px;width:14px;height:10px;
  background:var(--red-accent);clip-path:polygon(0 0,100% 0,50% 100%)}
.tl .cue b:hover::after{background:#f0b49b}
body.glisse-cue{user-select:none}
body.glisse-cue .tl .cue b::after{background:#f0b49b}
.tl .zoom{display:flex;gap:4px}
.tl .zoom button{font-family:var(--mono);font-size:8.5px;letter-spacing:.12em;padding:5px 10px;border-radius:6px;
  border:0;cursor:pointer;background:none;box-shadow:inset 0 0 0 1px var(--hairline);color:var(--ink-3);min-width:38px}
.tl .zoom button:hover{color:var(--ink-2)}
.tl .zoom button[aria-pressed="true"]{background:#b9cfd8;color:#0a0d0b;box-shadow:none}
.tl .chiffre{font-size:12px;color:var(--ink);min-width:40px;text-align:right}

/* ── casting : de vrais visages, toutes les vignettes au même format ── */
#casting .cast-sub{color:var(--ink-3)}
#casting .cast-grid{grid-template-columns:repeat(auto-fill,minmax(216px,1fr));gap:13px}
#casting .fiche{display:flex;flex-direction:column;height:100%;gap:0;padding:0;border:0;
  border-radius:14px;overflow:hidden;background:var(--surface-3);
  box-shadow:inset 0 0 0 1px rgba(47,107,74,.5),0 10px 22px -14px #000;
  transition:box-shadow .16s,transform .16s}
#casting .fiche:hover{box-shadow:inset 0 0 0 1px rgba(47,107,74,.95),0 14px 26px -14px #000;
  transform:translateY(-2px)}
/* L'image est un élément de flex : sans min-height:0 sa hauteur intrinsèque
   devient sa taille minimale, et un portrait en hauteur étire la carte. */
#casting .fiche .por{width:100%;height:auto;aspect-ratio:1/1;min-height:0;flex:none;
  object-fit:cover;border:0;cursor:grab;background:var(--stage)}
#casting .fiche .por:active{cursor:grabbing}
#casting .fiche .por.vide{aspect-ratio:1/1;font-size:30px}
#casting .fiche > div{padding:11px 12px 12px;display:flex;flex-direction:column;flex:1;min-width:0}
#casting .fiche .note{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
#casting .chiffres{margin-top:auto;padding-top:9px}
#casting .fiche.attrape{opacity:.4}
#casting .fiche.cible{box-shadow:0 0 0 2px var(--ok);transform:translateY(-3px)}
#casting input.nom{border-radius:7px;background:var(--stage);border-color:var(--hairline)}
#casting select.fus{border-radius:7px;background:var(--stage)}
#casting button{border-radius:10px;font-family:var(--ui)}
@media(max-width:560px){#casting .cast-grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}}

/* ── découpage : compteurs, filtres, accordéon ── */
.dp{display:flex;flex-direction:column;gap:12px;padding:18px 0 40px}
.dp-tete{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.dp-media{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px 18px;margin:12px 0 4px;padding:12px 14px;
  border:1px solid var(--hairline);border-radius:6px;background:var(--surface-2)}
.dp-media div{min-width:0}
.dp-media dt{font:600 9px/1.2 var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.dp-media dd{margin:4px 0 0;font:400 14px/1.3 var(--ui);color:var(--ink);overflow-wrap:anywhere}
.etat{display:flex;align-items:center;gap:8px;flex-wrap:wrap;border-radius:14px;background:var(--stage);padding:9px 12px}
.etat .m{display:inline-flex;align-items:center;gap:8px;border-radius:6px;padding:5px 12px;border:0;background:none;
  box-shadow:inset 0 0 0 1px var(--hairline);transition:box-shadow .15s}
.etat button.m{cursor:pointer}
.etat button.m:hover{box-shadow:inset 0 0 0 1px rgba(63,154,106,.95)}
.etat .m b{font-family:var(--disp);font-weight:400;font-size:14px;color:var(--ink)}
.etat .m span{font-family:var(--mono);font-size:8.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.etat .m.alerte{box-shadow:inset 0 0 0 1px var(--red-hairline)}
.etat .m.alerte b{color:var(--red-accent)}
.etat button.m[aria-pressed="true"]{background:#b9cfd8}
.etat button.m[aria-pressed="true"] b,.etat button.m[aria-pressed="true"] span{color:#0a0d0b}

.filtres{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.filtres input[type=search]{flex:1;min-width:180px;background:var(--stage);border:0;border-radius:10px;
  padding:9px 12px;font:400 12.5px var(--ui);color:var(--ink);box-shadow:inset 0 0 0 1px var(--hairline)}
.filtres input[type=search]:focus{outline:0;box-shadow:inset 0 0 0 1px var(--red-hairline)}
.filtres select{background:var(--stage);border:0;border-radius:10px;padding:9px 10px;font:400 11.5px var(--ui);
  color:var(--ink);box-shadow:inset 0 0 0 1px var(--hairline);max-width:220px}
.jeu{display:flex;gap:4px;flex-wrap:wrap}
.jeu button{font-family:var(--mono);font-size:8.5px;letter-spacing:.12em;text-transform:uppercase;border:0;cursor:pointer;
  padding:6px 11px;border-radius:7px;background:none;box-shadow:inset 0 0 0 1px var(--hairline);color:var(--ink-3)}
.jeu button:hover{color:var(--ink-2)}
.jeu button[aria-pressed="true"]{background:#b9cfd8;color:#0a0d0b;box-shadow:none}

.dp .table{display:flex;flex-direction:column;gap:3px}
.bloc{border-radius:10px;overflow:hidden}
.bloc[aria-expanded="true"]{background:var(--surface-2);box-shadow:inset 0 0 0 1px rgba(63,154,106,.8)}
.lg{display:grid;grid-template-columns:14px 46px minmax(0,1fr) 96px 104px 92px 66px;gap:11px;align-items:center;
  padding:8px 11px;cursor:pointer}
.lg:hover{background:var(--surface-2)}
.bloc.courant .lg .no{color:var(--red-accent)}
.lg .teinte{width:14px;height:14px;border-radius:4px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.14)}
.lg .no{font-family:var(--disp);font-size:13px;color:var(--ink)}
.lg .ac{font-size:12.5px;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lg .pts{display:flex;gap:3px;align-items:center}
.lg .pts i{width:9px;height:9px;border-radius:999px;display:block}
.lg .pts em{font-family:var(--mono);font-size:8px;font-style:normal;color:var(--ink-3)}
.lg .dr{font-family:var(--disp);font-size:12px;color:var(--ink);text-align:right}
.detail{display:none;padding:0 11px 13px;gap:12px;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr)}
.bloc[aria-expanded="true"] .detail{display:grid}
.detail .vues{display:flex;gap:6px;flex-wrap:wrap}
.detail .vues figure{margin:0;flex:1;min-width:132px}
.detail .vues img{width:100%;border-radius:7px;display:block}
.detail .vues figcaption{margin-top:4px}
.detail .bl{display:flex;flex-direction:column;gap:8px;min-width:0}
.detail .paire{display:grid;grid-template-columns:repeat(auto-fit,minmax(92px,1fr));gap:7px}
.detail .paire > div{background:var(--stage);border-radius:7px;padding:7px 9px;min-width:0}
.detail .paire .v{font-family:var(--disp);font-size:13px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.detail .rq{display:flex;gap:9px;align-items:baseline;padding:5px 0;box-shadow:inset 0 -1px 0 rgba(47,107,74,.22)}
.detail .rq .h{font-family:var(--mono);font-size:8px;letter-spacing:.1em;color:var(--ink-3);white-space:nowrap}
.detail .rq .x{font-size:12.5px;color:var(--ink-2)}
.detail .avert{border-radius:7px;box-shadow:inset 0 0 0 1px var(--red-hairline);padding:8px 10px;
  font-size:11.5px;color:var(--ink-2);line-height:1.5}
.dp .tetes{display:flex;flex-wrap:wrap;gap:6px}
.dp .tete{display:inline-flex;align-items:center;gap:7px;border-radius:6px;padding:3px 12px 3px 3px;
  background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--hairline)}
.dp .tete img{width:26px;height:26px;border-radius:4px;object-fit:cover}
.dp .tete span{font-size:11.5px;color:var(--ink-2);white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis}
.dp .tete b{font-family:var(--disp);font-size:11px;font-weight:400}
.pied-dp{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding-top:11px;
  box-shadow:inset 0 1px 0 rgba(47,107,74,.3)}
a.outil{text-decoration:none}
@media(max-width:1020px){.detail{grid-template-columns:minmax(0,1fr)}}
@media(max-width:760px){.lg{grid-template-columns:14px 44px minmax(0,1fr) 62px}.lg .cat,.lg .tai,.lg .pts{display:none}}

${VOIX_CSS}
</style>
</head>
<body>
<header class="bar">
  <div class="haut">
    <a class="retour" href="../../" title="Tous les projets"><svg viewBox="0 0 12 12"><path d="M8 2L4 6l4 4"/></svg>Accueil</a>
    <a class="mark" href="../../">Movie Analysis</a>
    <span class="title">${esc(DATA.title)}</span>
    <!-- les onglets dans la barre, sans numéros : un rang de moins au-dessus de la vidéo (28/09) ; les infos du média
         d'origine sont dans le Découpage -->
    <nav class="menu" role="tablist" aria-label="Vues">
      <div class="pan" id="tabs">
        <button data-tab="studio" aria-pressed="true"><span class="nm">Studio</span></button>
        <button data-tab="casting" aria-pressed="false"><span class="nm">Casting</span></button>
        <button data-tab="depouillement" aria-pressed="false"><span class="nm">Découpage</span></button>
        <span class="curseur" id="curseur"></span>
      </div>
    </nav>
  </div>
</header>

<main id="studio" class="wrap">
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
      <div class="nofile" id="nofile" hidden>La vidéo n'est pas à côté de cette page. Tout le reste — scénario, timeline, plans, silhouettes — fonctionne. <label class="link">Charge le fichier depuis ton disque<input type="file" accept="video/*" hidden></label>.</div>
    </div>
    <div class="sep-v" id="sep-cols" title="Glisser : largeur du script · double-clic : par défaut"></div>
    <aside class="script"><div class="script-in">
      <div class="script-head"><span class="lab">Script</span><span class="lab" style="color:var(--ink-2)">${DATA.shots.length} plans · ${new Set(DATA.shots.flatMap((s) => s.lines.map((l) => `${l.start}-${l.end}`))).size} répliques</span><span style="flex:1"></span><span class="lab" id="script-etat" style="color:var(--ok)"></span><label class="lab" style="display:flex;gap:6px;align-items:center;cursor:pointer;margin-left:10px"><input type="checkbox" id="follow" checked> suivre</label></div>
      <div class="script-body" id="script"></div>
    </div></aside>
  </section>
  <!-- tirer vers le haut : la vidéo rétrécit (ses vignettes avec), la timeline grandit ; double-clic : par défaut -->
  <div class="sep-h" id="sep-tl" title="Glisser : taille de la vidéo et de la timeline · double-clic : par défaut"></div>

  <section class="vx" id="tl">
    <div class="vx-tete">
      <span class="lab">Timeline · une piste par personnage</span>
      <span class="aide">chaque mot à son instant · glisser une réplique sur une autre piste pour la réattribuer, ou cliquer dessus</span>
      <span style="flex:1"></span>
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

<main id="depouillement" class="wrap" hidden>
  <div class="dp">
    <div class="dp-tete">
      <span class="lab">Dépouillement</span><span class="lab-s" id="dp-compte">—</span>
      <span style="flex:1"></span>
      <a class="outil" id="dp-rapport" href="${esc(reportHref)}" target="_blank" rel="noopener">Rapport complet</a>
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
      <span style="flex:1"></span>
      <button class="outil" id="dp-replier">Tout replier</button>
      <button class="outil" id="dp-csv">Exporter CSV</button>
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
// la video et les pistes de son sur R2 (--video-url) ; a cote de la page si R2 ne repond pas
window.XV_MEDIA = ${JSON.stringify(MEDIA)};
${CASTING.CORRECTIONS_JS}
${CASTING.appliqueNoms(slug)}
const FRAMES = ${JSON.stringify(FRAMES)};
const OVERLAYS = ${JSON.stringify(OVERLAYS)};
const PORTRAITS = ${JSON.stringify(PORTRAITS)};
const L = ${JSON.stringify(L)};
const VOIX = ${JSON.stringify(VOIX).replace(/[⺀-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))};
const SIZE_COLORS = ${JSON.stringify(SIZE_COLORS)}, RHYTHM_COLORS = ${JSON.stringify(RHYTHM_COLORS)}, CAST_COLORS = ${JSON.stringify(CAST_COLORS)};
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

/* ── thème : Verdant est sombre par construction, il n'y a plus de choix.
   On pose la marque pour les pages qui la lisent encore (le dépouillement). ── */
document.documentElement.dataset.theme = 'dark';
try { localStorage.setItem('xverse-theme', 'dark'); } catch {}

/* ── onglets ── */
${CASTING.ONGLETS}

/* ── le theme jusque dans le cadre du depouillement ── */
${CASTING.THEME_VERS_IFRAME}

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
/* Encre lisible sur une couleur pleine : le kit demande 4.5 de contraste. */
function encre(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return '#0a0d0b';
  const v = (k) => { const c = parseInt(hex.substr(k, 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const Lum = 0.2126 * v(1) + 0.7152 * v(3) + 0.0722 * v(5);
  return (Lum + 0.05) / 0.05 > 4.5 ? '#0a0d0b' : '#e6eae7';
}

${VOIX_JS}
${SON_JS}
function layout() { rendreTimeline(); paint(video.currentTime || 0, true); }
let lastShot = null, lastLine = null, lastCartes = null;
function paint(t, force) {
  $('hud-time').textContent = tc(t) + ' / ' + tc(D);
  majSousTitre(t);
  majCue(t);
  const s = shotAt(t);
  if (s && (force || s.id !== lastShot)) { lastShot = s.id; $('hud-shot').textContent = s.id; majVerdant(s); dessineAction(s, t); renderShot(s); markScript(s, t); if (history.replaceState) history.replaceState(null, '', '#' + s.id); }
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
  poignee('sep-tl', 'row', {
    depart: () => document.querySelector('.stage-row').getBoundingClientRect().height,
    applique: (h0, dx, dy) => { d.hs = Math.round(Math.max(380, Math.min(innerHeight * 0.92, h0 + dy))); },
  }, () => { delete d.hs; });
  poignee('sep-cols', 'col', {
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
      bloc.setAttribute('aria-expanded', String(ouverts.has(sh.id)));
      const lg = document.createElement('div'); lg.className = 'lg';
      const te = document.createElement('span'); te.className = 'teinte';
      te.style.background = sh.teinte || 'var(--surface-4)';
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

  /* Une correction change les noms et les fusions : la vue se refait. */
  window.xvRendreDecoupage = function () { majRoles(); rendre(); };
  majRoles(); rendre();
})();

/* Le curseur du menu d'onglets. */
function curseurOnglet() {
  const a = document.querySelector('#tabs button[aria-pressed="true"]'), c = $('curseur');
  if (!a || !c) return;
  c.style.width = a.offsetWidth + 'px';
  c.style.transform = 'translateX(' + a.offsetLeft + 'px)';
}
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => setTimeout(curseurOnglet, 0)));
addEventListener('resize', curseurOnglet);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(curseurOnglet);
curseurOnglet();

</script>
</body>
</html>`;

const out = flag('-o', 'studio.html');
// --fragment : l'hébergeur d'artefacts fournit lui-même <html>/<head>/<body>, on ne
// livre donc que le contenu (titre, styles, corps, script). La langue et le thème sont
// posés par script, sinon l'hôte impose le sien.
let page = html;
if (rest.includes('--fragment')) {
  const head = /<head>([\s\S]*?)<\/head>/i.exec(html)[1];
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)[1];
  const styles = [...head.matchAll(/<style[\s\S]*?<\/style>/gi)].map((m) => m[0]).join('\n');
  const title = (/<title>([\s\S]*?)<\/title>/i.exec(head) ?? [])[1] ?? 'Studio';
  page = `<title>${title}</title>\n<script>document.documentElement.lang='fr';</script>\n${styles}\n${body}`;
}
writeFileSync(out, page);
process.stderr.write(`studio → ${out} (${Math.round(Buffer.byteLength(page) / 1024)} Ko : ${Object.keys(FRAMES).length} images clés, ${Object.keys(OVERLAYS).length} calques, ${Object.keys(PORTRAITS).length} portraits)\n`);
