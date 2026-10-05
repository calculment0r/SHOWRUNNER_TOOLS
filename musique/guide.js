// ODIO — le GUIDE : l'aide intégrée, qui s'ouvre à côté de la session sans
// l'arrêter. Le parcours (chaque étape montre où cliquer), les raccourcis,
// et l'état des moteurs (ce qui est branché, ce qui tourne en essai).

import { api } from '../commun/shell.js';
import { el, drawer, put } from './ui.js';
import { options, bestStems } from './generatif.js';
import { REGLE as MOLETTE } from '../commun/molette.js';

const STEPS = [
  ['La session', 'Le tempo (− / +, la molette, ou « Tap » : le frapper), la tonalité et la mesure sont ceux de tout le morceau : le piano roll éclaire la gamme, les modèles de motifs et la génération les reprennent.', ['#mu-bpm', '#mu-tap', '#mu-key']],
  ['Les sections', 'La règle du haut : double-clic pour une section (intro, couplet, refrain…), double-clic dessus pour la renommer sur place, glisser pour la déplacer avec ses clips, clic droit pour la dupliquer avec ses clips, la colorer, l\'étiqueter pour les paroles.', ['.ar-secs']],
  ['Les pistes', 'Glisser un instrument du navigateur sous les pistes, ou « + Piste ». Chaque piste : muet (M), solo (S), armer (●), automation (A), volume, panoramique ; double-clic sur son nom : le renommer ; un clic sur sa barre de couleur la recolore (son nœud du nodal aussi). Un clic sur l\'en-tête la choisit (Ctrl : en ajouter, Maj : jusqu\'à elle), Suppr la retire. Glisser l\'en-tête : lâchée ENTRE deux pistes (un trait), elle s\'y range ; SUR une piste (elle s\'entoure), elles font groupe — un groupe se replie, se renomme, se défait (clic droit).', ['.nv', '.ar-head']],
  ['Les clips', 'Double-clic sur une piste : un clip neuf. Comme dans Live, la barre de titre d\'un clip est l\'objet : un clic le choisit, la glisser le déplace (Ctrl : le copier, Alt : sans aimant) ; Maj+clic ou Ctrl+clic : plusieurs. Le corps d\'un clip et le vide d\'une piste sont le temps : un clic y pose le marqueur d\'insertion (la tête de lecture y va), glisser y choisit une plage, sur une ou plusieurs pistes (Maj+clic : l\'étendre). Ctrl+E coupe (au marqueur, ou aux bords de la plage), Suppr retire ce que la plage contient, Ctrl+D la duplique, Ctrl+J en fait un clip (sur une piste MIDI vide : un clip vide). Le bord gauche rogne le début (la fin et le contenu restent en place), le droit la fin. Double-clic sur son titre : le renommer. Ctrl+glisser sur le vide : un cadre qui choisit des clips. La tête de lecture se prend par son onglet orange, en haut.', ['.ar-lane']],
  ['La vue de détail', 'En bas de l\'arrangement, une seule colonne qui défile : le clip choisi (les notes, les pas, le son d\'un clip audio, la génération d\'une région), puis toute la chaîne de la piste. Maj+Tab passe de l\'un à l\'autre ; le filet du haut se tire, sa hauteur reste. Un effet posé dans le nodal que deux pistes traversent est dans les deux chaînes, « lié » : le régler ici le règle pour les deux. Le navigateur, à gauche, se replie (‹ ou Ctrl+Alt+B).', ['.dk', '.nv']],
  ['Enregistrer', 'Armer une piste (●), activer « Rec » (F9), puis Lecture : jouer au clavier de l\'ordinateur (« Clavier » allumé : rangée du milieu, Z X l\'octave, C V la vélocité) ou en MIDI (menu ··· du projet). Stop : la prise se pose en clip « Nouveau ». Une piste audio armée prend le micro.', ['#mu-rec', '#mu-kbd', '.ar-head .arm']],
  ['Importer de l\'audio', 'Glisser des fichiers (WAV, MP3, FLAC, M4A, OGG) sur une piste ou sous les pistes, ou « Importer ». Ils entrent dans la bibliothèque (Upload) et se posent à la grille. La vue Clip règle début, fin, boucle, gain, transposition, inversion, fondus, et « Caler » au tempo.', ['[data-imp]']],
  ['L\'arc d\'énergie', 'La piste orange sous la règle : peindre à la souris (Maj : une droite, clic droit : effacer). Elle ouvre et ferme le filtre de la sortie, ou son volume. Chaque piste a aussi ses voies d\'automation (A).', ['.ar-arch', '.ar-arc']],
  ['Mixer', 'La console : un fader, un vu-mètre, des envois vers les bus d\'effets par piste ; un insert s\'ouvre dans la vue Instruments ; le nodal montre les mêmes câbles.', ['[data-view="console"]']],
  ['Le nodal et son banc', 'Tab : Arrangement ↔ Nodal, deux vues du même graphe : le nœud de départ d\'une piste porte son nom et sa couleur, les fils de sa chaîne aussi. Bouton du milieu glissé : se déplacer ; sur les réglages d\'une tuile, il TRACE l\'ordre de ce qu\'elle garde en dézoomant. Clic : choisir, Maj : ajouter, Ctrl : ajouter ou retirer, glisser le fond : un cadre. Un câble tiré d\'une piste vers un effet d\'une autre le met dans les deux chaînes. Sous le graphe, le banc d\'ODIO_01 : glisser sur une lane, un segment ; clic milieu tiré d\'un segment jusque sur le graphe, un attracteur. Clic droit partout : le menu de ce qu\'on survole.', ['[data-view="nodal"]']],
  ['Générer', 'YuE (paroles et voix) ou ACE-Step : le style, les sections de l\'arrangement comme plan des paroles, la durée, la graine. Le morceau se pose sur une piste audio, puis se sépare en voix, batterie, basse, autre — chacune sur sa piste, alignées.', ['#mu-gen']],
  ['Exporter', 'Le mixage en WAV 24 bits, et chaque piste à part (stems) : tout entre dans la bibliothèque ; « Envoyer au montage » ouvre le montage avec le mixage.', ['#mu-exp']],
];

// Les raccourcis : ceux de Live 12, relevés dans son manuel de référence,
// chapitre « Live Keyboard Shortcuts » (ableton.com/en/manual/live-keyboard-shortcuts,
// Live 12, consulté le 29/09/2026), et pour les gestes, le chapitre
// « Arrangement View » (ableton.com/en/manual/arrangement-view). Sur Mac,
// Ctrl se lit Cmd et Alt se lit Option. Ce qui est à ODIO seul est marqué.
// L'objet et le temps (05/10) : chapitre « Arrangement View », « Selecting
// Clips and Time » — relu par recherche web le 05/10/2026, ableton.com
// n'étant pas joignable depuis la machine d'essai.
export const LIVE_SOURCE = 'Ableton Live 12 Reference Manual · « Live Keyboard Shortcuts » et « Arrangement View » · consulté le 29/09/2026 (la sélection de temps : le 05/10/2026)';
const KEYS = [
  ['les vues', [
    ['Tab', 'Arrangement ↔ Nodal (Live : Session ↔ Arrangement)'],
    ['Maj+Tab · F12', 'panneau du bas : aller au clip ↔ à la chaîne (Live : Clip View ↔ Device View) ; F12, le navigateur web peut le garder pour ses outils'],
    ['Ctrl+Alt+3 · Ctrl+Alt+4', 'le clip · la chaîne de la piste'],
    ['Ctrl+Alt+B', 'montrer / cacher le navigateur'],
  ]],
  ['le transport', [
    ['Espace', 'lecture / arrêt (retour au départ)'], ['Maj+Espace', 'reprendre là où l\'on s\'est arrêté'],
    ['Origine (Home)', 'au début (Entrée aussi, l\'ancien raccourci d\'ODIO)'], ['F9', 'enregistrer (armer la prise)'],
    ['O (la lettre)', 'métronome (clavier MIDI éteint)'], ['Ctrl+L', 'boucle sur la sélection (sans clip choisi : allumer / éteindre la boucle)'],
    ['Maj+T', 'frapper le tempo (ODIO : Live n\'a pas de raccourci pour son bouton TAP)'],
  ]],
  ['l\'édition', [
    ['Ctrl+Z · Ctrl+Maj+Z · Ctrl+Y', 'annuler · rétablir (Mac : Cmd+Z, Cmd+Maj+Z) — la lettre Z, en AZERTY comme en QWERTY ; ↺ dans la barre : le journal des gestes'], ['Ctrl+X · C · V', 'couper · copier (les clips choisis, ou la plage) · coller au marqueur d\'insertion'],
    ['barre de titre d\'un clip', 'le choisir · le glisser : le déplacer (Live : l\'objet)'],
    ['clic dans un clip · dans une piste', 'le marqueur d\'insertion, et la tête de lecture à l\'arrêt (Live : le corps est le temps)'],
    ['glisser dans un clip · une piste', 'une plage de temps, sur une ou plusieurs pistes · Maj+clic : l\'étendre'],
    ['onglet de la tête de lecture', 'le glisser : la tête suit, aimantée (Alt : libre)'],
    ['Ctrl+D', 'dupliquer (une plage : sa copie juste après elle)'], ['Suppr', 'retirer la sélection (une plage : ce qu\'elle contient)'], ['Ctrl+R', 'renommer (le clip choisi, sinon la piste)'],
    ['Ctrl+A · Échap', 'tout choisir · rien'], ['Ctrl+E', 'couper (Live : Split) : au marqueur d\'insertion, aux bords d\'une plage, sinon les clips choisis à la tête de lecture'],
    ['Ctrl+J', 'consolider en un clip (Live : Consolidate) ; une plage : en faire un clip, vide sur une piste MIDI vide'], ['0 (zéro)', 'activer / désactiver les clips choisis'], ['R', 'inverser les clips audio choisis'],
    ['← →', 'déplacer les clips choisis d\'un pas de grille ; sans clip choisi : le marqueur ou la plage (Maj : l\'étendre)'], ['Ctrl+1 · Ctrl+2', 'resserrer · élargir la grille'], ['Ctrl+4', 'aimant allumé / éteint'],
    ['Alt en glissant', 'sans aimant'], ['Ctrl en glissant', 'copier les clips'], ['Ctrl+clic · Maj+clic', 'ajouter à la sélection'], ['Ctrl+glisser sur le vide', 'un cadre qui choisit des clips'],
  ]],
  ['les pistes et les clips', [
    ['Ctrl+T · Ctrl+Maj+T', 'une piste audio · MIDI — Chrome garde ces deux-là pour ses onglets (réservés, la page ne les reçoit pas) : « + Piste »'],
    ['Ctrl+Alt+T', 'un bus de retour'],
    ['Ctrl+Maj+M', 'un clip MIDI à la tête de lecture, sur la piste choisie'],
    ['Suppr', 'sur des en-têtes de piste choisis : les retirer (Ctrl+Z les rend)'],
    ['Ctrl+G · Ctrl+Maj+G', 'grouper les pistes choisies · défaire leur groupe (Live 12, § 42.19 : Group Selected Tracks, Ungroup Tracks)'],
    ['glisser un en-tête', 'entre deux pistes : la ranger là · sur une piste : grouper'],
    ['S · C · A', 'solo · armer · automation de la piste choisie (clavier MIDI éteint)'],
    ['Maj+M', 'un marqueur à la tête de lecture (ODIO)'],
  ]],
  ['la molette (la même dans toutes les timelines du portail)', MOLETTE],
  ['le zoom (chapitre « Arrangement View »)', [
    ['+ · −', 'zoomer · dézoomer'], ['Alt + / Alt −', 'hauteur de toutes les pistes'], ['Ctrl+Alt+glisser', 'déplacer la vue'],
    ['règle des temps', 'glisser à l\'horizontale : chercher · à la verticale : zoomer · double-clic : zoomer sur la sélection'],
    ['Z · X', 'zoomer sur la sélection · revenir (clavier MIDI éteint)'], ['W · H', 'tout le morceau en largeur · toutes les pistes en hauteur'],
  ]],
  ['le clavier MIDI de l\'ordinateur', [
    ['M', 'l\'allumer / l\'éteindre (bouton « Clavier »)'], ['A S D F G H J K L', 'jouer (touches blanches) · W E T Y U O P : noires'],
    ['Z · X', 'octave − / +'], ['C · V', 'vélocité − / +'],
  ]],
  ['les éditeurs', [
    ['Piano roll', '↑ ↓ transposer (Maj : octave) · Ctrl+U quantifier · Maj+glisser : choisir · double-clic : ôter · Alt+molette : zoom du temps · Ctrl+molette : hauteur des notes'],
    ['Onde d\'un clip audio', 'Alt+molette : zoom · Maj+molette ou glisser : défiler · double-clic : tout le son'],
    ['Nodal, le banc', '« c » : quelle tête gouverne (ODIO_01) · Suppr : retirer l\'attracteur choisi'],
    ['Nodal, la souris', 'bouton du milieu : se déplacer · sur les réglages d\'une tuile : tracer l\'ordre gardé au zoom (ODIO_01) · Maj+clic : ajouter · Ctrl+clic : ajouter ou retirer · ⌥ : retirer · l\'étiquette d\'une piste se glisse comme l\'en-tête de son nœud'],
    ['Nodal, l\'aimant', 'Ctrl+4 (ou « Aimant » dans la barre, ou le clic droit du fond) : allumé / éteint · ⌥ en glissant : libre le temps du geste'],
    ['Clic droit', 'partout : le menu de ce qu\'on survole (jamais celui du navigateur, sauf dans un champ texte)'],
  ]],
];

export function openGuide(app) {
  let tab = 'parcours';
  const seg = el('div', { class: 'seg' });
  const dr = drawer({ title: 'Guide', cls: 'guide', head: [seg] });
  const show = (sels) => {
    let first = null;
    for (const s of sels) for (const n of document.querySelectorAll(s)) {
      if (n.closest('.mu-drawer')) continue;
      n.classList.remove('mu-hl'); void n.offsetWidth; n.classList.add('mu-hl');
      setTimeout(() => n.classList.remove('mu-hl'), 2600);
      if (!first) first = n;
    }
    if (first) first.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    else { const v = sels.join(' ').includes('console') ? 'console' : 'timeline'; if (app.S.view !== v) { app.setView(v); setTimeout(() => show(sels), 120); } }
  };
  async function engines() {
    const [e, y, s] = await Promise.all([api('music/engines').catch((x) => ({ error: x.message })), options('music/yue/options', 'music.yue'), options('music/stems/options', 'music.stems')]);
    const b = s.ok ? bestStems(s.o) : null;
    const row = (name, ok, txt) => el('div', { class: 'gd-eng' }, el('i', { class: ok ? 'ok' : 'wait' }), el('b', {}, name), el('span', {}, txt));
    return [
      // (les options ne se lisent que si le travail est déclaré : contracts de /api/music/engines)
      row('YuE2', y.ok && y.o.engine !== 'factice' && y.o.ready !== false, !y.ok ? y.why
        : y.o.engine === 'factice' ? `déclaré · moteur d'essai (une mélodie, pas YuE2) · se branche par ${y.o.switch || '"music_yue": true'}` : y.o.ready ? 'branché · prêt' : `branché · ${y.o.why}`),
      row('ACE-Step 1.5', !!e.generate?.ok && e.mode !== 'factice', e.mode === 'factice' ? 'mode essai (un son synthétisé)' : e.generate?.ok ? `prêt · ${e.generate.machine || ''}` : e.generate?.why || e.error || ''),
      row('Séparation', s.ok && s.o.engine !== 'factice' && !!b, !s.ok ? s.why : !b ? 'aucun modèle prêt'
        : `${b.name} · ${b.stems.join(', ')}${s.o.engine === 'factice' ? ` · moteur d'essai (des filtres) · se branche par ${s.o.switch || '"music_stems": true'}` : ''}`),
      row('Web MIDI', !!navigator.requestMIDIAccess, navigator.requestMIDIAccess ? 'menu ··· du projet : « Brancher un clavier MIDI »' : 'ce navigateur ne le connaît pas'),
      row('Micro', !!navigator.mediaDevices?.getUserMedia && !!window.MediaRecorder, 'une piste audio armée + Rec'),
      row('Plaits (numérique)', typeof AudioWorkletNode !== 'undefined', typeof AudioWorkletNode !== 'undefined' ? 'AudioWorklet présent' : 'AudioWorklet absent : le numérique reste muet'),
    ];
  }
  async function paint() {
    put(seg, ...[['parcours', 'Parcours'], ['touches', 'Raccourcis'], ['moteurs', 'Moteurs']].map(([k, l]) =>
      el('button', { class: `tb${tab === k ? ' on' : ''}`, type: 'button', onclick: () => { tab = k; paint(); } }, l)));
    if (tab === 'parcours') {
      put(dr.body, el('p', { class: 'gd-intro' }, 'ODIO est un studio : des sections, des pistes, des clips, une console, et la génération. Chaque étape montre où cliquer ; la session continue de jouer derrière.'),
        STEPS.map(([t, txt, sels], i) => el('div', { class: 'gd-step' },
          el('span', { class: 'n' }, String(i + 1).padStart(2, '0')),
          el('div', {}, el('b', {}, t), el('p', {}, txt)),
          el('button', { class: 'tb ghost sm', type: 'button', onclick: () => show(sels) }, 'Montre-moi'))));
    } else if (tab === 'touches') {
      put(dr.body, el('p', { class: 'gd-src' }, `Les raccourcis de Live 12. Source : ${LIVE_SOURCE}.`),
        KEYS.map(([g, list]) => [el('h4', { class: 'gd-kh' }, g), el('dl', { class: 'gd-keys' }, list.map(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]))]),
        el('p', { class: 'lbl' }, 'le clavier joue par touches physiques : la même rangée en QWERTY et en AZERTY (KeyboardEvent.code, MDN) · Mac : Ctrl = Cmd, Alt = Option'));
    } else {
      put(dr.body, el('p', { class: 'lbl' }, 'lecture…'));
      put(dr.body, ...(await engines()));
    }
  }
  paint();
  return dr;
}
