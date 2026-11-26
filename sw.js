/* Service worker mínimo: deja la app y el SDK de Firebase guardados en el teléfono
   para que abra también sin señal. Los datos los guarda Firestore por su cuenta.
   Con señal siempre se baja la versión más nueva de la app; sin señal se usa la guardada. */
const VERSION = 'libreta-v2';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './firebase-config.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function externoPermitido(url) {
  return (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) ||
         url.hostname === 'fonts.googleapis.com' ||
         url.hostname === 'fonts.gstatic.com';
}

/* Archivos de la app: primero la red (siempre lo más nuevo), y si no hay señal, lo guardado. */
function redPrimero(request) {
  return fetch(request, { cache: 'no-cache' }).then(resp => {
    if (resp && resp.ok) {
      const copia = resp.clone();
      caches.open(VERSION).then(c => c.put(request, copia));
    }
    return resp;
  }).catch(() => caches.match(request, { ignoreSearch: true }));
}

/* SDK de Firebase y fuentes: no cambian, se responden desde lo guardado. */
function guardadoPrimero(request) {
  return caches.open(VERSION).then(cache =>
    cache.match(request).then(guardado => {
      if (guardado) return guardado;
      return fetch(request).then(resp => {
        if (resp && (resp.ok || resp.type === 'opaque')) cache.put(request, resp.clone());
        return resp;
      });
    })
  );
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) event.respondWith(redPrimero(req));
  else if (externoPermitido(url)) event.respondWith(guardadoPrimero(req));
});
