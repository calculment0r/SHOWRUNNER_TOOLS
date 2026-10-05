// ODIO — « ça calcule » : l'état d'un clip dont un travail de la file
// s'occupe (06/10, Cal : « Quand un segment est en calcul dans ODIO, on
// voudrait un retour visuel qui pulse ou change de couleur, un effet visuel
// élégant pour dire que ça calcule ; la piste juste avec des hachures, ce
// n'est pas suffisant »).
//
// Les travaux d'ODIO sont rangés dans le projet (P.pending, musique.js
// watchPending) : { job, kind, clip, … }. Ce module dit, pour un clip, le
// travail qui le concerne et où il en est dans la file (core/jobs, § 3 de
// docs/ARCHITECTURE.md : state, progress, message, ahead, eta_s), et pose sur
// sa boîte une couche « en calcul » (calcul.css) :
//   en file   une lueur qui respire lentement ; « en file · 2 devant · départ ≈ 4 min »
//   en cours  la lueur, un balayage lumineux qui avance, la vraie progression
//             (une barre) quand le travail la donne, l'étape (son message)
//   échec     l'ambre, fixe, et le message ; × l'efface (il reste jusque-là,
//             dans cette page : la file garde le travail et sa raison)
//   fini      la couche part, net (arrêté par la personne : aussi)
// Rien n'est repeint à chaque image : les animations sont en CSS, sur opacity
// et transform ; le relevé de la file (toutes les 1,5 s, commun/shell.js
// jobs.watch) récrit le texte et la barre, qui glisse (transition). Sous
// prefers-reduced-motion (ou Préférences → animations réduites) : un état
// fixe, lisible (calcul.css).
//
// Où : l'arrangement (le clip visé par le travail : la région qui génère, le
// clip qu'on sépare ou dont on extrait le MIDI) et la Session (une case dont
// le son est celui qu'on sépare ou qu'on transcrit — aucun travail ne part
// d'une case aujourd'hui). Le tiroir « Générer » (un morceau entier, kind
// generate) n'a pas de clip : il a sa propre liste.

import { jobs, fmtWait } from '../commun/shell.js';
import { el } from './ui.js';

// ce que fait chaque sorte de travail, pour la personne (les sortes : musique.js, generatif_*.js)
const VERBE = { takes: 'génère', abc: 'écrit la partition', midi: 'extrait le MIDI', stems: 'sépare en pistes', generate: 'génère' };
const FINI = new Set(['done', 'error', 'cancelled', 'interrupted']);
const ECHEC = new Set(['error', 'interrupted']);

let A = null;                      // l'application (brancherCalculs)
let releve = new Map();            // le dernier relevé de la file : id du travail → travail
const suivis = new Map();          // id du travail → { clip, item, kind, titre } : ce que la page attend
const echecs = new Map();          // id du clip ou du son → { verbe, message, titre }

// le clip qu'un travail vise : un id, ou (séparation) l'objet { track, start, len, clip }
const clipDe = (pd) => (typeof pd.clip === 'string' ? pd.clip : pd.clip?.clip || null);
// le son qu'il travaille : la séparation le dit ; l'extraction MIDI, par son clip
const sonDe = (pd) => pd.item || (pd.kind === 'midi' && A?.clip(clipDe(pd))?.item) || null;

// Brancher une fois (l'arrangement le fait en naissant : timeline.js) ; les
// vues refaites ensuite n'ajoutent rien.
export function brancherCalculs(app) {
  const premier = !A;
  A = app;
  if (!premier) return;
  jobs.watch((list) => {
    releve = new Map(list.map((j) => [j.id, j]));
    const P = A.S.proj;
    for (const pd of P?.pending || []) {
      if (suivis.has(pd.job)) continue;
      const s = { clip: clipDe(pd), item: sonDe(pd), kind: pd.kind, titre: pd.title || '' };
      suivis.set(pd.job, s);
      // un travail neuf sur ce clip : l'échec d'avant est dépassé
      if (s.clip) echecs.delete(s.clip);
      if (s.item) echecs.delete(s.item);
    }
    for (const [id, s] of [...suivis]) {
      const j = releve.get(id);
      const encore = (P?.pending || []).some((pd) => pd.job === id);
      if (j && FINI.has(j.state)) {
        if (ECHEC.has(j.state)) {
          const e = { verbe: VERBE[s.kind] || 'calcule', message: j.message || (j.state === 'interrupted' ? 'interrompu' : 'échec'), titre: j.title || s.titre };
          if (s.clip) echecs.set(s.clip, e);
          if (s.item) echecs.set(s.item, e);
        }
        suivis.delete(id);
      } else if (!j && !encore) suivis.delete(id);   // oublié de la file, plus attendu : rien à montrer
    }
    rafraichirCalculs();
  });
}

// L'état d'un clip (par son id) ou d'un son (par son item) : null quand rien
// ne le concerne ; sinon { st: file | cours | echec, verbe, p (0..1 ou null), texte, titre }.
export function etatCalcul({ clip = null, item = null } = {}) {
  const P = A?.S.proj;
  if (!P) return null;
  const pd = (P.pending || []).find((x) => (clip && clipDe(x) === clip) || (item && sonDe(x) === item));
  if (pd) {
    const j = releve.get(pd.job), verbe = VERBE[pd.kind] || 'calcule', titre = j?.title || pd.title || '';
    if (!j || j.state === 'queued') {
      let place = j?.message || 'en file';
      if (j?.eta_s != null && !/départ/.test(place)) place += j.eta_s < 30 ? ' · part bientôt' : ` · départ ≈ ${fmtWait(j.eta_s)}`;
      return { st: 'file', verbe, p: null, texte: place, titre };
    }
    if (j.state === 'running') {
      const p = typeof j.progress === 'number' ? Math.max(0, Math.min(1, j.progress)) : null;
      return { st: 'cours', verbe, p, texte: [p !== null ? `${Math.round(p * 100)} %` : '', j.message && j.message !== 'en cours' ? j.message : ''].filter(Boolean).join(' · '), titre };
    }
    if (ECHEC.has(j.state)) return { st: 'echec', verbe, p: null, texte: j.message || 'échec', titre };
    return null;   // fini ou arrêté : la couche part
  }
  const e = (clip && echecs.get(clip)) || (item && echecs.get(item));
  return e ? { st: 'echec', verbe: e.verbe, p: null, texte: e.message, titre: e.titre } : null;
}

// Pose (ou retire) la couche sur une boîte : un clip de l'arrangement, une
// case de la Session. `cle` : ce qu'efface le × d'un échec.
// Rend vrai quand l'état a changé de sorte (apparu, parti, en file → en cours…).
export function poserCalcul(box, etat, cle = null) {
  let c = box.querySelector(':scope > .calc');
  if (!etat) { if (!c) return false; c.remove(); box.classList.remove('calcule'); return true; }
  const avant = c?.dataset.st || null;
  if (!c) {
    c = el('div', { class: 'calc', 'aria-live': 'polite' },
      el('i', { class: 'calc-lueur', 'aria-hidden': 'true' }), el('i', { class: 'calc-balai', 'aria-hidden': 'true' }),
      el('span', { class: 'calc-tx' }, el('b'), el('span')), el('i', { class: 'calc-barre', 'aria-hidden': 'true' }));
    box.append(c);
  }
  box.classList.add('calcule');
  if (c.dataset.st !== etat.st) {
    c.dataset.st = etat.st;
    c.className = `calc ${etat.st}`;
    c.querySelector('.calc-x')?.remove();
    if (etat.st === 'echec' && cle) {
      c.append(el('button', { class: 'calc-x', type: 'button', title: 'effacer l\'échec (la file garde le travail et sa raison)',
        onpointerdown: (e) => e.stopPropagation(),
        onclick: (e) => { e.stopPropagation(); echecs.delete(cle); poserCalcul(box, etatCalcul(box.dataset.slot ? { item: cle } : { clip: cle }), cle); } }, '×'));
    }
  }
  const verbe = etat.st === 'echec' ? `échec · ${etat.verbe}` : etat.verbe;
  const [b, s] = c.querySelector('.calc-tx').children;
  if (b.textContent !== verbe) b.textContent = verbe;
  const t = etat.texte ? ` · ${etat.texte}` : '';
  if (s.textContent !== t) s.textContent = t;
  const ti = `${etat.titre ? `${etat.titre} — ` : ''}${verbe}${t}`;
  if (c.title !== ti) c.title = ti;
  const barre = c.querySelector('.calc-barre');
  barre.classList.toggle('ind', etat.p === null);
  if (etat.p !== null) barre.style.setProperty('--p', etat.p.toFixed(3));
  return avant !== etat.st;
}

// Le relevé de la file : chaque clip et chaque case montrés, mis à jour en place.
// Les clips dont l'état a changé de sorte sont dits par l'événement « mu:calcul »
// ({ clips }) : l'arrangement redessine leur toile (une région qui génère ne dit
// plus « à générer », timeline.js).
export function rafraichirCalculs(racine = document) {
  if (!A?.S.proj) return;
  const changes = [];
  for (const box of racine.querySelectorAll('.clip[data-id]')) if (poserCalcul(box, etatCalcul({ clip: box.dataset.id }), box.dataset.id)) changes.push(box.dataset.id);
  if (changes.length) document.dispatchEvent(new CustomEvent('mu:calcul', { detail: { clips: changes } }));
  for (const box of racine.querySelectorAll('.ss-c[data-slot]')) {
    const s = (A.S.proj.slots || []).find((x) => x.id === box.dataset.slot);
    poserCalcul(box, s?.item ? etatCalcul({ item: s.item }) : null, s?.item || null);
  }
}
