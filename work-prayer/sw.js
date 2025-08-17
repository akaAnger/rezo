const CACHE_NAME = 'wp-cache-v1';
const ASSETS = [
	'./',
	'./index.html',
	'./styles.css',
	'./script.js',
	'./data/prayers.json',
	'./data/predictions.json',
	'./assets/candle.svg',
	'./assets/share-base.png',
	'./icons/favicon.svg',
	'./icons/maskable.png',
	'./icons/icon-512.png',
	'./manifest.webmanifest'
];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then(keys => Promise.all(keys.map(k => k !== CACHE_NAME ? caches.delete(k) : null))).then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;
	event.respondWith(
		caches.match(req).then(cached => cached || fetch(req).then(res => {
			const copy = res.clone();
			caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
			return res;
		}).catch(() => caches.match('./index.html')))
	);
});