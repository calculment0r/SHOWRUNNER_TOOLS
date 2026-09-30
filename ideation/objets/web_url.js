// IDÉATION · OBJETS — l'adresse d'un objet « Web » : acceptée ou non, YouTube,
// Vimeo ou un site, et l'adresse d'intégration OFFICIELLE qui en découle
// (YouTube : « privacy-enhanced mode », www.youtube-nocookie.com/embed/<id> ;
// Vimeo : player.vimeo.com/video/<id>?dnt=1). Pure (ni DOM ni réseau) : la
// même règle que `parse` de server/tools/web_apercu.py, cas par cas (le
// contrôle du serveur la fait tourner par node et compare).
//
// L'adresse d'intégration n'est jamais lue dans la planche : elle se déduit
// ici de `url` (que le serveur a validée). Une opération d'un autre onglet ne
// peut donc pas glisser une autre adresse dans un cadre.

const MAX_URL = 2048;
const HOST_OK = /^(?:[A-Za-z0-9.-]{1,253}|\[[0-9A-Fa-f:.]{2,45}\])$/;
const YT_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'];
const YT_SHORT = ['youtu.be', 'www.youtu.be'];
const VIMEO_HOSTS = ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'];
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{1,12}$/;
const VIMEO_H = /^[0-9a-f]{6,20}$/;
const T_RX = /^(?:(\d{1,2})h)?(?:(\d{1,4})m)?(?:(\d{1,6})s?)?$/;

// « 90 », « 90s », « 1m30s », « 1h2m3s » → secondes (0 si illisible)
function start(v) {
  const m = T_RX.exec(v || '');
  if (!m || !(m[1] || m[2] || m[3])) return 0;
  return Math.min(86400, (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0));
}

// { ok, why, url, kind: youtube | vimeo | site, id, embed, host }
export function parseWeb(raw) {
  let u = String(raw ?? '').trim();
  const bad = (why) => ({ ok: false, why, url: u.slice(0, MAX_URL), kind: '', id: '', embed: '', host: '' });
  if (!u) return bad('une adresse vide');
  if (u.length > MAX_URL) return bad(`une adresse de plus de ${MAX_URL} signes`);
  if (/[\s\x00-\x1f\x7f]/.test(u)) return bad('une adresse ne contient ni espace ni caractère de contrôle');
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(u) && /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:\d+)?([/?#]|$)/.test(u)) u = 'https://' + u;
  const sm = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(u);
  const scheme = sm ? sm[1].toLowerCase() : '';
  if (scheme !== 'http' && scheme !== 'https') return bad(`seules les adresses http:// et https:// sont prises (${scheme ? scheme + ':' : 'sans schéma'} refusé)`);
  if (!/^https?:\/\//i.test(u)) return bad('une adresse web commence par http:// ou https://');
  const rest = u.split('://').slice(1).join('://');
  const authPart = rest.split(/[/?#]/)[0];
  if (authPart.includes('@')) return bad('une adresse avec un identifiant (nom@ ou nom:mot@) est refusée');
  let host = authPart.startsWith('[') ? authPart.slice(0, authPart.indexOf(']') + 1) : authPart.replace(/:\d*$/, '');
  if (!HOST_OK.test(host || '')) return bad('le nom du site est illisible');
  const portS = authPart.slice(host.length);
  if (portS && !/^:\d{1,5}$/.test(portS)) return bad('le port est illisible');
  host = host.toLowerCase();
  // le chemin et la requête, tels quels (comme urlsplit : ni décodés ni normalisés)
  const after = rest.slice(authPart.length);
  const noFrag = after.split('#')[0];
  const qi = noFrag.indexOf('?');
  const path = (qi < 0 ? noFrag : noFrag.slice(0, qi)) || '/';
  const q = new URLSearchParams(qi < 0 ? '' : noFrag.slice(qi + 1));
  const seg = path.split('/').filter(Boolean);
  const out = { ok: true, why: '', url: u, kind: 'site', id: '', embed: '', host };
  let vid = '';
  if (YT_HOSTS.includes(host)) {
    if (path === '/watch') vid = q.get('v') || '';
    else if (seg.length >= 2 && ['embed', 'shorts', 'live', 'v'].includes(seg[0])) vid = seg[1];
  } else if (YT_SHORT.includes(host) && seg.length) vid = seg[0];
  if (vid && YT_ID.test(vid)) {
    const t = start(q.get('t') || q.get('start') || '');
    return { ...out, kind: 'youtube', id: vid, embed: `https://www.youtube-nocookie.com/embed/${vid}${t ? `?start=${t}` : ''}` };
  }
  if (VIMEO_HOSTS.includes(host)) {
    let v = '', h = '';
    if (host === 'player.vimeo.com' && seg.length >= 2 && seg[0] === 'video') v = seg[1];
    else if (seg.length && VIMEO_ID.test(seg[0])) { v = seg[0]; h = seg.length >= 2 ? seg[1] : ''; }
    else if (seg.length >= 3 && seg[0] === 'channels') v = seg[2];
    else if (seg.length >= 4 && seg[0] === 'groups' && seg[2] === 'videos') v = seg[3];
    h = h || q.get('h') || '';
    if (VIMEO_ID.test(v || '')) {
      h = VIMEO_H.test(h) ? h : '';
      return { ...out, kind: 'vimeo', id: v, embed: `https://player.vimeo.com/video/${v}?dnt=1${h ? `&h=${h}` : ''}` };
    }
  }
  return out;
}

// l'adresse du lecteur quand on le lance : il démarre tout de suite (le clic sur la carte est le
// geste de l'utilisateur ; `allow="autoplay"` le délègue au cadre) et reste dans la carte sur iOS
export function playerSrc(p) {
  if (p.kind === 'youtube') return p.embed + (p.embed.includes('?') ? '&' : '?') + 'autoplay=1&playsinline=1';
  if (p.kind === 'vimeo') return p.embed + '&autoplay=1&playsinline=1';
  return '';
}
