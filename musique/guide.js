// ODIO — le GUIDE : l'aide intégrée, qui s'ouvre à côté de la session sans
// l'arrêter. Le parcours (chaque étape montre où cliquer), les raccourcis,
// et l'état des moteurs (ce qui est branché, ce qui tourne en essai).

import { api } from '../commun/shell.js';
import { el, drawer, put } from './ui.js';
import { options, bestStems } from './generatif.js';

const STEPS = [
  ['La session', 'Le tempo (− / + ou la molette), la tonalité et la mesure sont ceux de tout le morceau : le piano roll éclaire la gamme, les modèles de motifs et la génération les reprennent.', ['#mu-bpm', '#mu-key']],
  ['Les sections', 'La règle du haut : double-clic pour une section (intro, couplet, refrain…), double-clic dessus pour la nommer, glisser pour la déplacer avec ses clips, clic droit pour la dupliquer avec ses clips, la colorer, l\'étiqueter pour les paroles.', ['.ar-secs']],
  ['Les pistes', 'Glisser un instrument du navigateur sous les pistes, ou « + Piste ». Chaque piste : muet (M), solo (S), armer (●), automation (A), volume, panoramique ; un clic sur sa barre de couleur la recolore.', ['.nv', '.ar-head']],
  ['Les clips', 'Double-clic sur une piste : un clip neuf. Glisser un clip : le déplacer (Ctrl : le copier, Alt : sans aimant) ; ses bords : le rogner. Maj+clic ou un cadre tiré sur le vide : plusieurs. L\'éditeur du bas ouvre le clip choisi.', ['.ar-lane', '.dk']],
  ['Enregistrer', 'Armer une piste (●), activer « Rec », puis Lecture : jouer au clavier (rangée du milieu, Z X pour l\'octave) ou en MIDI (menu ··· du projet). Stop : la prise se pose en clip « Nouveau ». Une piste audio armée prend le micro.', ['#mu-rec', '.ar-head .arm']],
  ['Importer de l\'audio', 'Glisser des fichiers (WAV, MP3, FLAC, M4A, OGG) sur une piste ou sous les pistes, ou « Importer ». Ils entrent dans la bibliothèque (Upload) et se posent à la grille ; l\'éditeur audio règle gain, fondus et boucle.', ['[data-imp]']],
  ['L\'arc d\'énergie', 'La piste orange sous la règle : peindre à la souris (Maj : une droite, clic droit : effacer). Elle ouvre et ferme le filtre de la sortie, ou son volume. Chaque piste a aussi ses voies d\'automation (A).', ['.ar-arch', '.ar-arc']],
  ['Mixer', 'La console : un fader, un vu-mètre, des envois vers les bus d\'effets par piste ; les inserts s\'ouvrent dans le rack ; le nodal montre les mêmes câbles.', ['[data-view="console"]']],
  ['Générer', 'YuE (paroles et voix) ou ACE-Step : le style, les sections de l\'arrangement comme plan des paroles, la durée, la graine. Le morceau se pose sur une piste audio, puis se sépare en voix, batterie, basse, autre — chacune sur sa piste, alignées.', ['#mu-gen']],
  ['Exporter', 'Le mixage en WAV 24 bits, et chaque piste à part (stems) : tout entre dans la bibliothèque ; « Envoyer au montage » ouvre le montage avec le mixage.', ['#mu-exp']],
];

const KEYS = [
  ['Espace', 'lecture / arrêt (retour au départ)'], ['Entrée · Origine', 'retour au début'], ['R', 'enregistrer (armer la prise)'],
  ['C', 'métronome'], ['B', 'boucle'], ['M', 'marqueur à la tête de lecture'],
  ['A S D F G H J K L', 'jouer (touches blanches) · W E T Y U O P : noires'], ['Z · X', 'octave − / +'],
  ['Ctrl+Z · Ctrl+Y', 'annuler · rétablir'], ['Ctrl+C · X · V', 'copier · couper · coller à la tête de lecture'],
  ['Ctrl+D', 'dupliquer'], ['Ctrl+E', 'couper le clip à la tête de lecture'], ['Suppr', 'retirer la sélection'],
  ['Ctrl+A · Échap', 'tout choisir · rien'], ['← →', 'déplacer la sélection d\'un pas de grille'],
  ['Alt en glissant', 'sans aimant'], ['Ctrl en glissant', 'copier les clips'], ['Maj+clic', 'ajouter à la sélection'],
  ['Ctrl+molette', 'zoom horizontal'], ['Ctrl+Maj+molette', 'hauteur des pistes'], ['Maj+molette', 'défiler'],
  ['Piano roll', '↑ ↓ transposer (Maj : octave) · Q quantifier · Maj+glisser : choisir · double-clic : ôter'],
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
      put(dr.body, el('dl', { class: 'gd-keys' }, KEYS.map(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])),
        el('p', { class: 'lbl' }, 'le clavier joue par touches physiques : la même rangée en QWERTY et en AZERTY (KeyboardEvent.code, MDN)'));
    } else {
      put(dr.body, el('p', { class: 'lbl' }, 'lecture…'));
      put(dr.body, ...(await engines()));
    }
  }
  paint();
  return dr;
}
