// SHOWRUNNER TOOLS — l'éditeur de paroles calées (LRC) : relire, recaler en écoutant, corriger.
//
// Cal, 05/10 (docs/etudes/musique_spaces_playlists.md § 3 point 4) : « un LRC par ligne, relu et corrigible dans
// un petit éditeur (toucher une ligne pendant l'écoute pour la recaler) ». Le calage sans saisie est au serveur
// (server/tools/paroles.py : la voix seule, puis les mots de Transcrire, puis l'alignement) ; ici, la main.
//
//   import('/commun/lrc.js').then(({ ouvrirEditeurLrc }) => ouvrirEditeurLrc({ item, lrc, lyrics, onSave, enregistrer }))
//     item         l'objet audio de la bibliothèque (ou son identifiant) : le son qu'on écoute
//     lrc          le LRC de départ ; absent : celui du son (GET /api/paroles/<id>)
//     lyrics       des paroles sans temps, quand il n'y a pas encore de LRC : une ligne par ligne, réparties sur la
//                  durée, marquées « estimées » jusqu'à ce qu'on les pose ; absentes : celles que le serveur connaît
//     onSave(lrc, rep)   après chaque enregistrement (rep : la réponse de `enregistrer`)
//     enregistrer(lrc)   où écrire ; par défaut le champ `lrc` du son (POST /api/paroles/<id>) — une playlist qui garde
//                  ses paroles par morceau passe la sienne (« Caler automatiquement » n'est alors pas proposé)
//     caler        vrai : lancer le calage automatique dès l'ouverture, si on peut (la carte « Caler les paroles »)
//   → { el, fermer() }
//   lireLrc(texte) → [{ t, x }] · ecrireLrc(lignes) → texte · tempsLrc(s) → « mm:ss.cc »
//
// Les gestes : pendant l'écoute, toucher une ligne (ou Entrée : la ligne choisie) la pose à l'instant entendu et
// choisit la suivante ; à l'arrêt, toucher une ligne y mène la lecture. Alt + ← → : la ligne choisie de ± 0,1 s
// (Maj : 0,5 s) ; « Décaler tout » de ± x s ; ✎ (ou double-clic) corrige le texte. Espace : lecture. Ctrl+Z,
// Ctrl+Maj+Z : la pile de l'éditeur. Rien à « enregistrer » (CLAUDE.md, règle 7) : chaque geste s'enregistre seul,
// la pastille le dit ; « Revenir » remet le LRC de l'ouverture.

import { el, api, toast } from './shell.js';
import { lecteur } from './lecteur.js';

let cssOn = false;
const css = () => {
  if (cssOn) return;
  cssOn = true;
  document.head.append(el('link', { rel: 'stylesheet', href: new URL('./lrc.css', import.meta.url).href }));
};

// ── le format ───────────────────────────────────────────────
const TAG = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
const META = /^\s*\[(ti|ar|al|au|by|re|ve|length|la|lang|offset):([^\]]*)\]\s*$/i;
export function tempsLrc(s) {
  const cs = Math.max(0, Math.round((+s || 0) * 100));
  const m = Math.floor(cs / 6000), r = cs % 6000;
  return `${String(m).padStart(2, '0')}:${String(Math.floor(r / 100)).padStart(2, '0')}.${String(r % 100).padStart(2, '0')}`;
}
// les lignes datées d'un LRC, dans l'ordre des temps ; le décalage [offset:±ms] appliqué (comme le serveur)
export function lireLrc(txt) {
  let off = 0;
  const out = [];
  for (const raw of String(txt || '').replace(/^﻿/, '').split(/\r?\n/)) {
    const m = raw.match(META);
    if (m) { if (m[1].toLowerCase() === 'offset') off = (parseFloat(m[2]) || 0) / 1000; continue; }
    const ts = [...raw.matchAll(TAG)].map((g) => parseInt(g[1], 10) * 60 + parseFloat(g[2].replace(':', '.')));
    if (!ts.length) continue;
    const x = raw.replace(TAG, '').trim();
    for (const t of ts) out.push({ t: Math.max(0, t - off), x });
  }
  return out.sort((a, b) => a.t - b.t);
}
export const ecrireLrc = (lignes) => lignes.slice().sort((a, b) => a.t - b.t).map((l) => `[${tempsLrc(l.t)}]${l.x}`).join('\n') + (lignes.length ? '\n' : '');
// des paroles sans temps : les lignes chantées (sans les étiquettes [verse], (Refrain), ni les lignes vides)
const lignesDe = (txt) => String(txt || '').split(/\r?\n/).map((r) => r.replace(TAG, '').trim())
  .filter((r) => r && !/^[[(][^\])]{0,40}[\])]$/.test(r) && !META.test(r));
const r2 = (x) => Math.round(x * 100) / 100;
const fmtS = (x) => `${String(x).replace('.', ',')} s`;

export async function ouvrirEditeurLrc({ item, lrc = null, lyrics = null, onSave = () => {}, enregistrer = null, caler = false } = {}) {
  css();
  const it = typeof item === 'string' ? await api('library/' + item) : item;
  if (!it || it.kind !== 'audio') throw new Error('des paroles calées ne vont qu’à un son');
  const parDefaut = !enregistrer;
  const ecrire = enregistrer || ((txt) => api(`paroles/${it.id}`, { method: 'POST', body: { lrc: txt } }));
  const S = { lignes: [], sel: 0, edit: -1, actif: -1, srv: null, etat: 'enregistré', pile: [], refaire: [], t0: [], timer: 0,
    envoi: null, defile: 0, poll: 0, ferme: false, pas: 0.5 };
  try { S.srv = await api(`paroles/${it.id}`); } catch (e) { if (parDefaut) throw e; }
  const duree = () => (L && L.duree) || it.duration || S.srv?.item?.duration || 0;
  const tactile = matchMedia('(pointer: coarse)').matches;

  // ── les lignes de départ : le LRC, sinon des paroles sans temps réparties sur la durée (estimées) ──
  function depart() {
    const txt = lrc ?? S.srv?.lrc ?? '';
    const est = new Set(lrc === null ? S.srv?.estimees || [] : []);
    const rows = lireLrc(txt).map((l, k) => ({ t: l.t, x: l.x, est: est.has(k) }));
    if (rows.length) return rows;
    const ls = lignesDe(lyrics ?? S.srv?.paroles ?? '');
    const d = it.duration || 0;
    return ls.map((x, k) => ({ t: r2(d ? (d * (k + 0.5)) / Math.max(1, ls.length) * 0.9 : k * 3), x, est: true }));
  }
  S.lignes = depart();
  S.t0 = clone(S.lignes);
  S.sel = Math.max(0, S.lignes.findIndex((l) => l.est));
  function clone(ls) { return ls.map((l) => ({ ...l })); }

  // ── la boîte ──
  const titre = el('b', { class: 'lrc-titre', title: it.title || '' }, it.title || it.id);
  const pastille = el('span', { class: 'lrc-etat lbl', 'aria-live': 'polite' });
  const bAnnuler = el('button', { class: 'tb ghost sm', type: 'button', title: 'annuler (Ctrl+Z)', onclick: () => annuler() }, '↶');
  const bRefaire = el('button', { class: 'tb ghost sm', type: 'button', title: 'rétablir (Ctrl+Maj+Z)', onclick: () => refaire() }, '↷');
  const lect = el('div', { class: 'lrc-lect' });
  const liste = el('div', { class: 'lrc-liste', role: 'list', 'aria-label': 'les lignes des paroles' });
  const pasIn = el('input', { class: 'fld lrc-pas', type: 'number', min: '0.01', max: '30', step: '0.1', value: String(S.pas), 'aria-label': 'décalage en secondes' });
  const bMoins = el('button', { class: 'tb ghost sm', type: 'button', 'data-decaler': '-1', onclick: () => decaler(-1) }, '');
  const bPlus = el('button', { class: 'tb ghost sm', type: 'button', 'data-decaler': '1', onclick: () => decaler(1) }, '');
  const bRevenir = el('button', { class: 'tb ghost sm', type: 'button', title: 'remettre les paroles telles qu’à l’ouverture', onclick: () => revenir() }, 'Revenir');
  const bCaler = parDefaut ? el('button', { class: 'tb ghost sm lrc-caler', type: 'button', onclick: () => calerAuto() }, 'Caler automatiquement') : null;
  const chaine = el('span', { class: 'lrc-chaine', 'aria-live': 'polite' });
  const aide = el('p', { class: 'lrc-aide' });
  const paintPas = () => {
    const p = fmtS(S.pas);
    bMoins.textContent = `− ${p}`; bPlus.textContent = `+ ${p}`;
    bMoins.title = `toutes les lignes ${p} plus tôt`; bPlus.title = `toutes les lignes ${p} plus tard`;
  };
  pasIn.addEventListener('input', () => { const v = parseFloat(String(pasIn.value).replace(',', '.')); if (v > 0 && v <= 30) { S.pas = v; paintPas(); } });
  paintPas();

  const box = el('div', { class: 'modal lg lrc-modal', role: 'dialog', 'aria-label': 'paroles calées' },
    el('div', { class: 'modal-head' }, el('span', { class: 't' }, 'Paroles calées'), titre, el('span', { class: 'sp' }), pastille,
      el('span', { class: 'lrc-undo', role: 'group', 'aria-label': 'annuler, rétablir' }, bAnnuler, bRefaire),
      el('button', { class: 'tb ghost sm', type: 'button', 'data-fermer': '', title: 'fermer (Échap)', onclick: () => fermer() }, 'Fermer')),
    lect,
    el('div', { class: 'lrc-outils' },
      el('span', { class: 'lbl' }, 'décaler tout'), bMoins, pasIn, bPlus, el('span', { class: 'sp' }), chaine, bCaler, bRevenir),
    aide, liste);
  const scrim = el('div', { class: 'scrim lrc-scrim', onclick: (e) => { if (e.target === scrim) fermer(); } }, box);
  document.body.append(scrim);

  // ── le son : LE lecteur du portail (sa frise porte une marque par ligne) ──
  const L = lecteur(it, { clavier: false, onTemps: (t, lecture) => suivre(t, lecture) });
  lect.append(L.el);
  const marques = L.piste(el('div', { class: 'lrc-marques', 'aria-hidden': 'true' }));
  L.media.addEventListener('play', () => { for (const m of document.querySelectorAll('audio, video')) if (m !== L.media && !m.paused) m.pause(); });
  L.media.addEventListener('loadedmetadata', () => paintMarques());

  // ── peindre ──
  function paintAide(lecture = L.lecture) {
    aide.textContent = lecture
      ? `À l’écoute : touche une ligne au moment où elle commence${tactile ? '' : ' (ou Entrée pour la ligne choisie)'} — elle se pose là, la suivante est choisie.`
      : tactile ? 'À l’arrêt : toucher une ligne y mène la lecture · ✎ corrige le texte · ‹ › décalent la ligne choisie.'
        : 'À l’arrêt : toucher une ligne y mène la lecture · ✎ ou double-clic corrige le texte · Alt + ← → décale la ligne choisie.';
  }
  function paintMarques() {
    const d = duree();
    marques.replaceChildren(...(d ? S.lignes.map((l, k) => el('i', { class: `lrc-m${k === S.sel ? ' sel' : ''}${l.est ? ' est' : ''}`,
      style: { left: `${Math.min(100, (l.t / d) * 100)}%` } })) : []));
  }
  function ligne(l, k) {
    const avant = k > 0 && S.lignes[k - 1].t > l.t;
    const row = el('div', { class: `lrc-l${k === S.sel ? ' sel' : ''}${k === S.actif ? ' on' : ''}${l.est ? ' est' : ''}${avant ? ' desordre' : ''}`,
      role: 'listitem', 'data-k': k, tabindex: '-1' },
    el('span', { class: 'lrc-t', title: l.est ? 'temps estimé : à poser en écoutant' : (avant ? 'avant la ligne précédente' : '') }, tempsLrc(l.t)),
    S.edit === k
      ? el('input', { class: 'fld lrc-in', type: 'text', value: l.x, maxlength: '300', 'aria-label': 'le texte de la ligne' })
      : el('span', { class: 'lrc-x' }, l.x || ' '),
    l.est ? el('span', { class: 'lrc-est', title: 'estimée : aucun mot de cette ligne n’a été reconnu' }, '≈') : null,
    k === S.sel && S.edit !== k ? el('span', { class: 'lrc-fin' },
      el('button', { class: 'tb ghost sm', type: 'button', 'data-pousser': '-1', title: '0,1 s plus tôt (Alt + ←, Maj : 0,5 s)' }, '‹'),
      el('button', { class: 'tb ghost sm', type: 'button', 'data-pousser': '1', title: '0,1 s plus tard (Alt + →, Maj : 0,5 s)' }, '›')) : null,
    S.edit === k ? null : el('button', { class: 'tb ghost sm lrc-ed', type: 'button', title: 'corriger le texte', 'aria-label': 'corriger le texte' }, '✎'));
    return row;
  }
  function paint() {
    const y = liste.scrollTop;
    liste.replaceChildren(...(S.lignes.length ? S.lignes.map(ligne)
      : [el('p', { class: 'lrc-vide' }, parDefaut ? 'Pas encore de paroles : « Caler automatiquement », ou donne les paroles dans la recette.' : 'Pas de paroles.')]));
    liste.scrollTop = y;
    const inp = liste.querySelector('.lrc-in');
    if (inp) { inp.focus(); inp.select(); }
    paintMarques(); paintAide(); paintEtat();
  }
  function paintEtat() {
    pastille.textContent = S.etat;
    pastille.classList.toggle('err', /^échec/.test(S.etat));
    bAnnuler.disabled = !S.pile.length; bRefaire.disabled = !S.refaire.length;
    bRevenir.disabled = JSON.stringify(S.t0) === JSON.stringify(S.lignes);
    const ch = S.srv?.calage;
    const enCours = ch && ['voix', 'mots', 'calage'].includes(ch.state);
    if (bCaler) {
      const why = enCours ? 'un calage est en cours' : (S.srv?.peut?.why || '');
      bCaler.disabled = !!why;
      bCaler.title = why || 'la voix seule, puis les mots entendus, puis l’alignement sur ces paroles (quelques minutes)';
      bCaler.textContent = S.lignes.length ? 'Recaler automatiquement' : 'Caler automatiquement';
    }
    chaine.textContent = !ch ? '' : enCours ? `${ch.etape}${ch.progress != null ? ` · ${Math.round(ch.progress * 100)} %` : ''}…`
      : ch.state === 'fini' ? [ch.message, ch.note].filter(Boolean).join(' · ') : ch.state === 'echec' || ch.state === 'arrete' ? `calage ${ch.etape} : ${ch.message}` : '';
    chaine.classList.toggle('err', !!ch && (ch.state === 'echec'));
  }
  // la ligne qu'on entend : la dernière dont le temps est passé (dans l'ordre des temps)
  function suivre(t, lecture) {
    let k = -1, best = -1;
    S.lignes.forEach((l, i) => { if (l.t <= t + 0.05 && l.t >= best) { best = l.t; k = i; } });
    if (k !== S.actif) {
      liste.querySelector('.lrc-l.on')?.classList.remove('on');
      S.actif = k;
      const row = liste.querySelector(`.lrc-l[data-k="${k}"]`);
      if (row) {
        row.classList.add('on');
        if (lecture && Date.now() > S.defile) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
    if (lecture !== S.lecture) { S.lecture = lecture; paintAide(lecture); }
  }
  liste.addEventListener('wheel', () => { S.defile = Date.now() + 3000; }, { passive: true });
  liste.addEventListener('touchmove', () => { S.defile = Date.now() + 3000; }, { passive: true });

  // ── les gestes ──
  function changer(fn, cle = '') {
    const avant = clone(S.lignes);
    fn();
    const top = S.pile[S.pile.length - 1];
    if (cle && top && top.cle === cle && Date.now() - top.at < 700) top.at = Date.now();   // des gestes rapprochés : un seul
    else S.pile.push({ lignes: avant, sel: S.sel, cle, at: Date.now() });
    if (S.pile.length > 200) S.pile.shift();
    S.refaire = [];
    plusTard();
    paint();
  }
  function annuler() {
    const e = S.pile.pop();
    if (!e) return;
    S.refaire.push({ lignes: clone(S.lignes), sel: S.sel });
    S.lignes = e.lignes; S.sel = Math.min(e.sel, Math.max(0, S.lignes.length - 1));
    plusTard(); paint();
  }
  function refaire() {
    const e = S.refaire.pop();
    if (!e) return;
    S.pile.push({ lignes: clone(S.lignes), sel: S.sel, cle: '', at: 0 });
    S.lignes = e.lignes; S.sel = e.sel;
    plusTard(); paint();
  }
  // poser la ligne k à l'instant t ; les lignes estimées qui suivent et passeraient avant elle se répartissent
  // entre elle et la prochaine ligne posée (la règle du serveur : interpolées entre leurs voisines)
  function poser(k, t) {
    if (k < 0 || k >= S.lignes.length) return;
    changer(() => {
      const ls = S.lignes;
      ls[k] = { ...ls[k], t: r2(Math.max(0, t)), est: false };
      let j = k + 1;
      while (j < ls.length && ls[j].est) j++;
      const fin = j < ls.length ? ls[j].t : Math.max(duree(), ls[k].t + 3 * (j - k));
      if (j > k + 1 && ls.slice(k + 1, j).some((l) => l.t <= ls[k].t || l.t >= fin)) {
        for (let i = k + 1; i < j; i++) ls[i] = { ...ls[i], t: r2(ls[k].t + ((fin - ls[k].t) * (i - k)) / (j - k)) };
      }
      S.sel = Math.min(k + 1, ls.length - 1);
    });
    const row = liste.querySelector(`.lrc-l[data-k="${S.sel}"]`);
    if (row && Date.now() > S.defile) row.scrollIntoView({ block: 'nearest' });
  }
  function pousser(k, d) {
    if (k < 0 || k >= S.lignes.length) return;
    changer(() => { S.lignes[k] = { ...S.lignes[k], t: r2(Math.max(0, S.lignes[k].t + d)), est: false }; }, `pousser-${k}`);
  }
  function decaler(sens) {
    if (!S.lignes.length) return;
    const d = sens * S.pas;
    changer(() => { S.lignes = S.lignes.map((l) => ({ ...l, t: r2(Math.min(Math.max(0, l.t + d), duree() || Infinity)) })); }, `decaler-${sens}`);
    toast(`toutes les lignes ${fmtS(S.pas)} plus ${sens < 0 ? 'tôt' : 'tard'}`);
  }
  function revenir() { changer(() => { S.lignes = clone(S.t0); }); }
  function choisir(k) {
    S.sel = k;
    liste.querySelectorAll('.lrc-l.sel').forEach((n) => n.classList.remove('sel'));
    paint();
  }
  function editer(k) { S.edit = k; S.sel = k; paint(); }
  function finEdit(garder) {
    const k = S.edit;
    if (k < 0) return;
    const v = liste.querySelector('.lrc-in')?.value ?? '';
    S.edit = -1;
    if (garder && v.trim() !== S.lignes[k].x) changer(() => { S.lignes[k] = { ...S.lignes[k], x: v.trim().slice(0, 300) }; });
    else paint();
  }
  liste.addEventListener('click', (e) => {
    const row = e.target.closest('.lrc-l');
    if (!row) return;
    const k = +row.dataset.k;
    const b = e.target.closest('button');
    if (b?.dataset.pousser) { pousser(k, +b.dataset.pousser * (e.shiftKey ? 0.5 : 0.1)); return; }
    if (b?.classList.contains('lrc-ed')) { editer(k); return; }
    if (e.target.closest('.lrc-in')) return;
    if (L.lecture) { poser(k, L.t); return; }
    choisir(k);
    L.seek(S.lignes[k].t);
  });
  liste.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.lrc-l');
    if (row && !L.lecture && !e.target.closest('button, .lrc-in')) editer(+row.dataset.k);
  });
  liste.addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('lrc-in')) return;
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finEdit(true); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finEdit(false); }
  });
  liste.addEventListener('focusout', (e) => {   // quitter le champ garde le texte
    if (e.target.classList.contains('lrc-in')) setTimeout(() => { if (S.edit >= 0 && !liste.contains(document.activeElement)) finEdit(true); }, 0);
  });

  const champ = (t) => t && t.closest && t.closest('input, textarea, select, [contenteditable]');
  function cle(e) {
    if (S.ferme || !scrim.isConnected) return;
    if (e.key === 'Escape') { if (S.edit < 0) { e.preventDefault(); e.stopPropagation(); fermer(); } return; }
    if (champ(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); if (e.shiftKey) refaire(); else annuler(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); e.stopPropagation(); refaire(); return; }
    if (mod) return;
    if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (e.target.matches?.('button')) e.target.blur(); L.toggle(); return; }
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (L.lecture) poser(S.sel, L.t); else editer(S.sel); return; }
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault(); e.stopPropagation();
      pousser(S.sel, (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.5 : 0.1)); return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault(); e.stopPropagation();
      choisir(Math.max(0, Math.min(S.lignes.length - 1, S.sel + (e.key === 'ArrowUp' ? -1 : 1))));
      liste.querySelector(`.lrc-l[data-k="${S.sel}"]`)?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); L.seek(Math.max(0, L.t + (e.key === 'ArrowLeft' ? -2 : 2))); }
  }
  document.addEventListener('keydown', cle, true);

  // ── enregistrer : seul, un instant après le dernier geste ──
  function plusTard() {
    S.etat = 'à enregistrer…';
    clearTimeout(S.timer);
    S.timer = setTimeout(envoyer, 700);
    paintEtat();
  }
  async function envoyer() {
    clearTimeout(S.timer);
    S.timer = 0;
    if (S.envoi) { await S.envoi; if (S.timer) return; }
    const txt = ecrireLrc(S.lignes);
    S.etat = 'enregistre…'; paintEtat();
    S.envoi = (async () => {
      try {
        const rep = await ecrire(txt);
        if (parDefaut && rep && typeof rep === 'object') S.srv = { ...S.srv, ...rep };
        S.etat = 'enregistré';
        try { onSave(txt, rep); } catch (err) { console.error(err); }
      } catch (err) {
        S.etat = `échec : ${err.message}`;
        toast(`paroles non enregistrées : ${err.message}`, 6000);
      }
      paintEtat();
    })();
    await S.envoi;
    S.envoi = null;
  }

  // ── caler automatiquement (le serveur : la voix seule, les mots, l'alignement) ──
  async function calerAuto() {
    if (S.timer) await envoyer();
    const paroles = S.lignes.map((l) => l.x).filter((x) => x.trim()).join('\n');
    try {
      S.srv = await api(`paroles/${it.id}/caler`, { method: 'POST', body: paroles ? { paroles } : {} });
      toast('calage en file : la voix seule, les mots, puis l’alignement');
    } catch (err) { toast(err.message, 7000); return; }
    paintEtat();
    attendre();
  }
  function attendre() {
    clearTimeout(S.poll);
    const ch = S.srv?.calage;
    if (S.ferme || !ch || !['voix', 'mots', 'calage'].includes(ch.state)) return;
    S.poll = setTimeout(async () => {
      try {
        const avant = S.srv?.calage?.state;
        S.srv = await api(`paroles/${it.id}`);
        if (S.srv.calage?.state === 'fini' && avant !== 'fini') {
          const neuves = lireLrc(S.srv.lrc);
          const est = new Set(S.srv.estimees || []);
          // le résultat entre dans la pile : Ctrl+Z rend les lignes d'avant (et les réenregistre)
          S.pile.push({ lignes: clone(S.lignes), sel: S.sel, cle: '', at: 0 });
          S.lignes = neuves.map((l, k) => ({ t: l.t, x: l.x, est: est.has(k) }));
          S.sel = Math.max(0, S.lignes.findIndex((l) => l.est));
          S.etat = 'enregistré';
          toast(S.srv.calage.note || 'paroles calées');
          paint();
          try { onSave(S.srv.lrc, S.srv); } catch (err) { console.error(err); }
        }
      } catch { /* le portail ne répond pas : on redemande */ }
      paintEtat();
      attendre();
    }, 1200);
  }

  async function fermer() {
    if (S.ferme) return;
    S.ferme = true;
    clearTimeout(S.poll);
    document.removeEventListener('keydown', cle, true);
    if (S.edit >= 0) finEdit(true);
    if (S.timer || S.envoi) await envoyer();
    L.detruire();
    scrim.remove();
  }

  paint();
  attendre();
  if (caler && parDefaut && !bCaler.disabled) calerAuto();
  return { el: box, fermer, lignes: () => clone(S.lignes), lecteur: L };
}
