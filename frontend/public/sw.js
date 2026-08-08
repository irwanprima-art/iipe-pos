/* Service Worker SuperBazaar — app shell cache + offline fallback */
const CACHE = 'superbazaar-v1'

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(['/', '/index.html', '/manifest.webmanifest', '/icon.svg']))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  // API tidak pernah di-cache
  if (url.pathname.startsWith('/api/')) return

  e.respondWith(
    caches.match(req).then((cached) => {
      const fetched = fetch(req)
        .then((resp) => {
          if (resp && resp.ok) {
            const clone = resp.clone()
            caches.open(CACHE).then((c) => c.put(req, clone))
          }
          return resp
        })
        .catch(() => cached)
      return cached || fetched
    })
  )
})
