// Service Worker：ネット優先。オンライン時は常に最新を取得し（更新が普通の再読込で反映）、
// オフライン時のみキャッシュから起動する。献立AIへの通信は素通し。
const CACHE = 'ai-kitchen-1.3.0';
const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/main.js',
  './js/ui.js',
  './js/store.js',
  './js/api.js',
  './js/util.js',
  './js/icons.js',
  './js/version.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname === 'generativelanguage.googleapis.com') return; // AI通信は素通し
  if (url.origin !== location.origin) return; // 他オリジンは素通し
  // ネット優先：まずネットワーク、成功したらキャッシュも更新。失敗（オフライン）時だけキャッシュ。
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html')))
  );
});
