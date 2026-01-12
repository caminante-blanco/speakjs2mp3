const CACHE_NAME = 'speakjs2mp3-v6';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './cheatsheet.html',
  './script.js',
  './lib/lame.min.js',
  './lib/mespeak/mespeak.js',
  './lib/mespeak/mespeak-core.js',
  './lib/mespeak/mespeak_config.json',
  './lib/mespeak/voices/en/en-rp.json'
];

self.addEventListener('install', (event) => {
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
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});