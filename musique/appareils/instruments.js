// ODIO — les synthés de la vue Instruments : Synthé, Analog, Numérique
// (Plaits), Basse acide.
//
// La référence : les instruments de Live 12 (Analog, Wavetable) et de
// Bitwig (Polysynth) — l'enveloppe se dessine et se tire, le filtre montre
// sa courbe et la course de son enveloppe (docs/etudes/odio_appareils.md § 3.6).
// Deux surfaces :
//   le filtre      filtres.js (compact), la courbe au repos et au sommet de
//                  l'enveloppe de filtre ;
//   l'enveloppe    l'enveloppe d'amplitude telle que le moteur la pose :
//                  attaque droite, puis selon l'instrument une approche
//                  exponentielle (Synthé : setTargetAtTime, τ = déclin / 4 ;
//                  Plaits : τ = déclin × 0,35, son worklet) ou des droites
//                  (Analog : linearRampToValueAtTime) ; les poignées A
//                  (l'attaque), D (le déclin à l'horizontale, la tenue à la
//                  verticale), R (la chute). Le temps est en logarithme par
//                  segment : 5 ms et 3 s se lisent sur la même largeur.
// Les formes d'onde se choisissent sur leur dessin.

import { el, menu } from '../ui.js';
import { FAMILLES, PATCHS_FM, harmoDuPatch, patchDeHarmo } from '../plaits/macro.js';   // les moteurs de Macro, par famille ; les patchs FM-6 (06/10)
import { MODULES } from '../modules.js';
import { filtre, icone as iconeFiltre, A_FILTRE } from './filtres.js';
import { ecran, s, trait, poignee, gestes, liaison, trace, choixLie, iconeOnde, plusProche, AIDE } from './surface.js';

// les clés de l'enveloppe et la forme de ses segments
const ENV = {
  synth: { a: 'a', d: 'd', s: 's', r: 'r', forme: 'exp', tau: 0.25 },
  analog: { a: 'attack', d: 'decay', s: 'sustain', r: 'release', forme: 'lin' },
  plaits: { a: 'attack', d: 'decay', s: 'sustain', r: 'release', forme: 'exp', tau: 0.35 },
  macro: { a: 'attack', d: 'decay', s: 'sustain', r: 'release', forme: 'exp', tau: 0.35 },   // son worklet : la même enveloppe que le Numérique
};
export const A_INSTRUMENT = (type) => ['synth', 'analog', 'plaits', 'acid', 'macro', 'resonateur', 'physique'].includes(type);

// ── l'enveloppe ─────────────────────────────────────────────
// px(t) = K · ln(1 + t / T0) pour chaque segment ; la tenue a une largeur fixe
const T0 = 0.01;
export function enveloppe(app, m, { w = 220, h = 96, L: lie = null } = {}) {
  const K = ENV[m.type];
  const L = lie || liaison(app, m);
  L.ecoute(() => peindre());
  const TENUE = Math.round(w * 0.16), HAUT = 14, BAS = h - 6;
  const max = ['a', 'd', 'r'].map((k) => Math.log(1 + L.sp(K[k]).max / T0));
  const KX = (w - TENUE - 8) / (max[0] + max[1] + max[2]);
  const px = (t) => KX * Math.log(1 + t / T0), tDe = (p) => T0 * (Math.exp(Math.max(0, p) / KX) - 1);
  const yDe = (v) => BAS - v * (BAS - HAUT);
  const E = ecran(w, h, 'ap-env');
  const aire = s('path', { class: 'ap-aire' }), courbe = s('path', { class: 'ap-courbe' }), gate = s('path', { class: 'ap-pre' });
  E.c.courbes.append(aire, gate, courbe);
  const pA = poignee('A', 'A'), pD = poignee('D', 'D'), pR = poignee('R', 'R');
  E.c.points.append(pA, pD, pR);
  // pas de lecture sur l'écran : les molettes, dessous, disent les valeurs (l'attaque monte à gauche, là où elle serait)
  E.c.grille.append(trait(0, BAS, w, BAS, 'zero'));

  function peindre() {
    const a = L.get(K.a), d = L.get(K.d), sv = L.get(K.s), r = L.get(K.r);
    const x0 = 4, xA = x0 + px(a), xD = xA + px(d), xS = xD + TENUE, xR = xS + px(r);
    const pts = [[x0, BAS], [xA, yDe(1)]];
    // le déclin et la chute, échantillonnés dans le temps (leur forme vraie), posés sur l'axe logarithmique
    const seg = (x1, t, v0, v1, fin) => {
      for (let i = 1; i <= 40; i++) {
        const u = (i / 40) * t;
        const v = K.forme === 'lin' ? v0 + (v1 - v0) * (u / t) : v1 + (v0 - v1) * Math.exp(-u / (K.tau * t));
        pts.push([x1 + px(u), yDe(fin && i === 40 && K.forme === 'lin' ? v1 : v)]);
      }
    };
    seg(xA, d, 1, sv, false);
    pts.push([xS, pts[pts.length - 1][1]]);
    seg(xS, r, pts[pts.length - 1][1] === yDe(sv) ? sv : (BAS - pts[pts.length - 1][1]) / (BAS - HAUT), 0, true);
    courbe.setAttribute('d', trace(pts));
    aire.setAttribute('d', `${trace(pts)} L${pts[pts.length - 1][0]} ${BAS} Z`);
    // la note tenue : de l'attaque au relâchement
    gate.setAttribute('d', `M${x0} ${BAS + 3} H${xS}`);
    pA.poser(xA, yDe(1)); pD.poser(xD, yDe(sv)); pR.poser(Math.min(w - 6, xR), BAS - 7);
  }

  let base = 0, vy = 0;
  gestes(E, {
    trouver: (p) => { const id = plusProche(p, [['R', pR], ['D', pD], ['A', pA]], 11); return id ? { id, curseur: id === 'D' ? 'move' : 'ew-resize' } : null; },
    survol: (c) => { for (const [id, q] of [['A', pA], ['D', pD], ['R', pR]]) q.classList.toggle('survol', c?.id === id); },
    debut: ({ id }) => { base = px(L.get(K[id.toLowerCase()])); vy = L.get(K.s); for (const [i, q] of [['A', pA], ['D', pD], ['R', pR]]) q.classList.toggle('on', i === id); },
    tire: ({ id }, d) => {
      base += d.dx;
      L.pose(K[id.toLowerCase()], tDe(base), id === 'D');
      if (id === 'D') { vy -= d.dy / (BAS - HAUT); L.pose(K.s, vy); }
    },
    fin: () => { for (const q of [pA, pD, pR]) q.classList.remove('on'); L.fin(); },
    double: ({ id }) => { const k = K[id.toLowerCase()]; L.pose(k, L.defaut(k), id === 'D'); if (id === 'D') L.pose(K.s, L.defaut(K.s)); L.fin(); },
  });
  E.box.title = `A : l'attaque · D : le déclin (horizontal) et la tenue (vertical) · R : la chute · ${AIDE}`;
  peindre();
  return { el: E.box, peindre, L };
}

// Le moteur de Macro : 24 choix, un bouton qui ouvre le menu commun, rangé
// par famille (plaits/macro.js, FAMILLES) — 24 boutons côte à côte ne tiennent pas
function choixMoteur(L, sp) {
  const b = el('button', { class: 'tb ghost sm ap-moteur', type: 'button', title: 'le moteur de Plaits (24)' });
  const peindre = () => { b.textContent = `${sp.opts[Math.round(L.get('moteur'))] || ''} ▾`; };
  b.onclick = () => {
    const r = b.getBoundingClientRect(), cur = Math.round(L.get('moteur'));
    menu(r.left, r.bottom + 4, FAMILLES.flatMap(([nom, a, z]) => [{ head: nom.toLowerCase() },
      ...sp.opts.slice(a, z).map((o, j) => ({ label: o, checked: cur === a + j, onclick: () => { L.pose('moteur', a + j); L.fin(); peindre(); } }))]));
  };
  L.ecoute(peindre);
  peindre();
  return el('div', { class: 'mu-choice ap-choix' }, el('span', { class: 'lbl' }, sp.label), b);
}

// Les moteurs FM-6 de Macro (2 à 4) : HARMO choisit l'un des 32 patchs DX7 de
// la banque ; ce bouton les nomme (plaits/macro.js, PATCHS_FM). Ailleurs il se tait.
function choixPatch(L) {
  const b = el('button', { class: 'tb ghost sm ap-moteur', type: 'button', title: 'le patch DX7 de la banque (HARMO le choisit)' });
  const banque = () => Math.round(L.get('moteur')) - 2;
  const peindre = () => {
    const k = banque();
    b.hidden = !(k >= 0 && k < 3);
    if (!b.hidden) b.textContent = `${PATCHS_FM[k][patchDeHarmo(L.get('harmo'))]} ▾`;
  };
  b.onclick = () => {
    const r = b.getBoundingClientRect(), k = banque(), cur = patchDeHarmo(L.get('harmo'));
    menu(r.left, r.bottom + 4, [{ head: `fm-6 · banque ${k + 1}` }, ...PATCHS_FM[k].map((nom, i) => ({ label: nom, sub: `${i + 1}`, checked: i === cur,
      onclick: () => { L.pose('harmo', harmoDuPatch(i)); L.fin(); peindre(); } }))]);
  };
  L.ecoute(peindre);
  peindre();
  return b;
}

// ── un instrument ───────────────────────────────────────────
export function instrument(app, m, { accent = 'cy' } = {}) {
  if (m.type === 'synth') return synthe(app, m, accent);
  // une seule liaison pour le module : les deux surfaces et les molettes se suivent
  const L = liaison(app, m);
  const def = MODULES[m.type];
  // le Résonateur et Physique (09/10) n'ont ni filtre ni enveloppe d'amplitude : leurs molettes seules
  const fl = A_FILTRE(m.type) ? filtre(app, m, { accent, w: m.type === 'acid' ? 300 : 240, h: 96, compact: true, L }) : null;
  const en = ENV[m.type] ? enveloppe(app, m, { w: 200, h: 96, L }) : null;
  const mol = (k, i) => {
    const sp = def.params.find((p) => p.k === k);
    if (!sp) return null;
    if (m.type === 'macro' && k === 'moteur') return choixMoteur(L, sp);
    if (m.type === 'macro' && k === 'harmo') return el('div', { class: 'ap-macro-harmo' }, choixPatch(L), L.molette(k, { accent: i === 0 ? accent : 'cy' }));
    // une forme d'onde, un mode de filtre : leur dessin ; un modèle de Plaits : son nom
    const dessin = k === 'wave' ? (j, o) => iconeOnde(o) : k === 'fmode' ? (j) => iconeFiltre(['lowpass', 'bandpass', 'highpass'][j]) : null;
    if (sp.opts) return choixLie(L, k, { dessin, apres: () => fl?.peindre() });
    return L.molette(k, { accent: i === 0 ? accent : 'cy' });
  };
  const groupes = {
    analog: [['Oscillateur', ['wave', 'detune']], ['Filtre', ['cutoff', 'resonance', 'envAmount']], ['Enveloppe', ['attack', 'decay', 'sustain', 'release']], ['Sortie', ['gain']]],
    plaits: [['Oscillateur', ['modele', 'harmo', 'timbre', 'morph']], ['Filtre', ['fmode', 'cutoff', 'resonance', 'envAmount']], ['Enveloppe', ['attack', 'decay', 'sustain', 'release']], ['Sortie', ['gain']]],
    acid: [['Oscillateur', ['wave', 'glide']], ['Filtre', ['cutoff', 'resonance', 'envMod', 'decay', 'accent']], ['Sortie', ['gain']]],
    macro: [['Moteur', ['moteur', 'harmo', 'timbre', 'morph', 'aux']], ['Porte basse', ['jeu', 'declin', 'couleur']], ['Filtre', ['fmode', 'cutoff', 'resonance', 'envAmount']],
      ['Enveloppe', ['attack', 'decay', 'sustain', 'release']], ['Sortie', ['gain']]],
    // Rings (mutable/resonateur.js) : ses quatre potentiomètres, son modèle, sa polyphonie, l'accord des cordes sympathiques
    resonateur: [['Modèle', ['modele', 'poly', 'accord']], ['Résonateur', ['structure', 'brillance', 'amorti', 'position']], ['Sortie', ['largeur', 'gain']]],
    // Elements (mutable/physique.js) : les trois excitateurs, le résonateur, l'espace
    physique: [['Excitation', ['contour']], ['Archet', ['archet', 'archet_t']], ['Souffle', ['souffle', 'flux', 'souffle_t']], ['Frappe', ['frappe', 'maillet', 'frappe_t']],
      ['Résonateur', ['resonateur', 'geometrie', 'brillance', 'amorti', 'position']], ['Sortie', ['espace', 'gain']]],
  }[m.type];
  groupes.push(['Arpège', ['arp', 'arp_div', 'arp_oct', 'arp_gate']]);   // 06/10 : arpege.js
  const surfaces = fl || en ? el('div', { class: 'ap-duo' },
    fl ? el('div', { class: 'ap-cadre-s' }, el('span', { class: 'lbl' }, m.type === 'acid' ? 'filtre · 18 dB/oct. · course de l\'enveloppe' : 'filtre · course de l\'enveloppe'), fl.el) : null,
    en ? el('div', { class: 'ap-cadre-s' }, el('span', { class: 'lbl' }, 'enveloppe d\'amplitude'), en.el) : null) : null;
  const reglages = el('div', { class: 'ap-groupes' }, groupes.map(([nom, ks]) => el('div', { class: 'ap-groupe' },
    el('span', { class: 'lbl' }, nom), el('div', { class: 'ap-kns' }, ks.map(mol)))));
  const root = el('div', { class: 'ap ap-instr' }, surfaces, reglages);
  return { el: root, frame: () => {}, peindre: () => { fl?.peindre(); en?.peindre(); } };
}

// le Synthé du studio : ses sections (oscillateurs, filtre, enveloppe,
// sortie) comme avant, le filtre et l'enveloppe devenus des surfaces
function synthe(app, m, accent) {
  const def = MODULES.synth;
  const L = liaison(app, m);
  const fl = filtre(app, m, { accent, w: 200, h: 70, compact: true, L });
  const en = enveloppe(app, m, { w: 200, h: 70, L });
  const ondeSvg = () => {
    const ic = iconeOnde(def.params.find((p) => p.k === 'wave').opts[Math.round(L.get('wave'))]);
    ic.setAttribute('class', 'ap-onde'); ic.setAttribute('width', 200); ic.setAttribute('height', 40); ic.setAttribute('preserveAspectRatio', 'none');
    return el('div', { class: 'ap-ecran ap-onde-e' }, ic);
  };
  let onde = ondeSvg();
  const mol = (k, i) => (def.params.find((p) => p.k === k).opts
    ? choixLie(L, k, { dessin: (j, o) => (/^(wave|wave2|lfo_w)$/.test(k) ? iconeOnde(o) : null), apres: () => onde.replaceWith(onde = ondeSvg()) })
    : L.molette(k, { accent: i === 0 ? accent : 'cy' }));
  // 06/10 (odio_synthes.md § 6 : « le Synthé est très large dans le rack, environ 2 800 px ») :
  // deux rangées — le module borné en largeur, ses sections passent à la ligne et leurs
  // réglages aussi (appareils.css) — et chaque section se replie d'un clic sur son nom.
  // Repliée, elle dit si l'un de ses réglages s'écarte du défaut, et lesquels (sa bulle) :
  // rien n'est perdu, un clic la rouvre. Le repli vaut pour tous les Synthés du projet
  // (S.proj.ui.replis.synth), comme un réglage de la page.
  const replis = () => (app.S.proj.ui.replis = app.S.proj.ui.replis || {});
  const replie = (name) => (replis().synth || []).includes(name);
  const ecarts = (keys) => keys.filter((k) => Math.abs(Number(L.get(k)) - Number(L.defaut(k))) > 1e-9);
  const sections = def.sections.map(([name, keys]) => {
    const point = el('i', { class: 'ap-sec-ecart', 'aria-hidden': 'true' });
    const tete = el('button', { class: 'ap-sec-t', type: 'button' }, el('span', { class: 'lbl' }, name), point);
    const sec = el('div', { class: 'sec' }, tete,
      name === 'Oscillateur A' ? onde : name === 'Filtre' ? fl.el : name === 'Enveloppe' ? en.el : null,
      el('div', { class: 'kns' }, keys.map(mol)));
    const peindre = () => {
      const r = replie(name), e = ecarts(keys);
      sec.classList.toggle('replie', r);
      tete.setAttribute('aria-expanded', String(!r));
      point.hidden = !r || !e.length;
      tete.title = r ? `${name} — repliée · ${e.length ? e.map((k) => `${L.sp(k).label} ${L.texte(k)}`).join(' · ') : 'tout au défaut'} · clic : la déplier`
        : `${name} · clic : la replier (pour tous les Synthés du projet)`;
    };
    tete.addEventListener('click', () => {
      const l = new Set(replis().synth || []);
      if (l.has(name)) l.delete(name); else l.add(name);
      if (l.size) replis().synth = [...l]; else delete replis().synth;
      app.saveUi();
      peindre();
    });
    L.ecoute(peindre);
    peindre();
    return sec;
  });
  return { el: el('div', { class: 'dev-body synth ap-synth' }, sections), frame: () => {}, peindre: () => { fl.peindre(); en.peindre(); } };
}
