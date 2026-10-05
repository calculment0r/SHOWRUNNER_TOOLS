// service-worker.js — l'application installable du lien d'écoute (PWA).
//
// Celui d'AGOSTA (service-worker.js du dépôt calculment0r/AGOSTA), repris : le réseau d'abord pour toute
// l'interface (HTML, CSS, JS, images, playlist.json, paroles), le cache seulement hors ligne — jamais un HTML neuf
// avec d'anciens scripts. Les fichiers AUDIO ne sont PAS interceptés : le navigateur gère le flux et les requêtes
// partielles (Range), indispensables à la lecture et aux sauts sur iPhone ; la playlist n'est jamais téléchargée
// entière en arrière-plan.
//
// Généralisé : tous les liens d'une même adresse (…/ecoute/<jeton>/ sur Cloudflare) partagent l'origine, donc le
// stockage des caches ; chaque lien a le sien, nommé d'après sa portée, et n'efface que les siens.

const VERSION = 'v1';
const PORTEE = self.registration.scope;
const PREFIXE = `ecoute:${PORTEE}:`;
const CACHE = PREFIXE + VERSION;

const APP_SHELL = [
  './', './index.html', './ecoute.css', './player.js', './app.js', './playlist.json', './manifest.webmanifest',
  './assets/cover-1200.jpg', './assets/cover-512.jpg', './assets/icon-192.png', './assets/icon-512.png',
];

self.addEventListener('install', (event) => {
  // un à un : une playlist sans pochette n'a pas cover-*.jpg, et cache.addAll échouerait pour tout
  event.waitUntil(caches.open(CACHE).then((cache) => Promise.all(APP_SHELL.map((u) => cache.add(u).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k.startsWith(PREFIXE) && k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

const isAudio = (request, url) => request.destination === 'audio' || /\.(mp3|m4a|aac|ogg|wav|flac)(\?|$)/i.test(url.pathname);

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(PORTEE)) return;
  if (isAudio(request, url)) return;   // l'AUDIO : le navigateur s'en charge (flux, Range)
  // le reste : le réseau d'abord, le cache en repli (hors ligne)
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: false }).then((hit) => hit || caches.match('./index.html'))),
  );
});
