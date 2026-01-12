const CACHE_NAME = 'speakjs2mp3-v18';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './_headers',
  './cheatsheet.html',
  './script.v13.js',
  './lib/lame.min.js',
  './lib/mespeak/mespeak.js',
  './lib/mespeak/mespeak-core.js',
  './lib/mespeak/mespeak_config.json',
  './lib/mespeak/voices/en/en-rp.json',
  './lib/ffmpeg/ffmpeg.min.js',
  './lib/ffmpeg/ffmpeg-core.js',
  './lib/ffmpeg/ffmpeg-core.wasm'
];

self.addEventListener('install', (event) => {
  // Force this new service worker to become the active one, bypassing the "waiting" state
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Opened cache');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      // Cache hit - return response
      if (response) {
        return response;
      }
      return fetch(event.request);
    })
  );
});

self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  // Claim any clients immediately, so they use this new SW without a reload
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheWhitelist.indexOf(cacheName) === -1) {
              return caches.delete(cacheName);
            }
          })
        );
      })
    ])
  );
});