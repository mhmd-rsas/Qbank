// Service worker: makes the site work offline.
// Strategy: network first (so a new push always shows up when online), saved copy only when the network fails.
// cec92b59c7e7 is replaced by tools/build_site_v2.py; a new version removes the old saved copy.
const CACHE = 'qbank-cec92b59c7e7';
const CORE = ["./", "index.html", "app.js", "theme.js", "style.css", "manifest.webmanifest", "favicon.svg", "icon-180.png", "icon-192.png", "icon-512.png", "data/registry.json", "data/all.json", "data/images/l01_innate_immunity_p31_27.jpg", "data/images/l02_complement_system_p15_24.jpg", "data/images/l03_antigen_presentation_p40_28.jpg", "data/images/l05_vaccines_p23_14.jpg", "data/images/l07_rbc_membrane_enzyme_p11_35.jpg", "data/images/l07_rbc_membrane_enzyme_p6_02.jpg", "data/images/l08_thrombosis_thrombophilia_p15_02.jpg", "data/images/l09_overview_hemostasis_p10_05.jpg", "data/images/l09_overview_hemostasis_p13_08.jpg", "data/images/l10_disorders_hemostasis_p21_05.jpg", "data/images/l11_lab_bleeding_measures_p20_05.jpg", "data/images/l12_hemophilia_p22_59.jpg", "data/images/l12_hemophilia_p9_23.jpg"];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(CORE.map(u => c.add(new Request(u, {cache: 'reload'}))))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('qbank-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req, {cache: 'no-cache'});
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, {ignoreSearch: true}) || (req.mode === 'navigate' ? await cache.match('./') : null);
      if (hit) return hit;
      throw err;
    }
  })());
});
